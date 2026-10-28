// relay_send_auth — sender authentication for POST /relay/send.
//
// Before this, ingress accepted any wire from anyone: the outer envelope
// carries no sender, so the relay could not tell who was filling a
// recipient's queue. Now every send carries a detached Ed25519 signature,
// made with the sender's did:peer:2 signing key (the same key the drain
// handshake already proves), in four request headers. The wire body stays
// byte-identical to what it was, so submit() and the DIDComm layer are
// untouched.
//
//   x-tw-relay-did    sender DID (did:peer:2 — the relay resolves its key locally)
//   x-tw-relay-ts     sender clock, ms since epoch, decimal
//   x-tw-relay-nonce  16+ random bytes, base64url, unique per send
//   x-tw-relay-sig    base64url Ed25519 signature over sendSigningInput(...)
//
// Signed bytes (UTF-8, newline separated):
//   "trustweb-relay-send/v1" \n did \n ts \n nonce \n hex(sha256(wire bytes))
// The fixed prefix domain-separates this from the drain handshake (which
// signs a bare server nonce), so one signature can never serve as the other.
// The wire hash binds the signature to the exact body, hence to the
// recipient in its outer `to`.
//
// Replay: a send is valid only inside ±windowMs of the relay's clock AND only
// once — the (did, nonce) pair is remembered until its timestamp can no
// longer pass the window check. Nonces are remembered only after the
// signature verified, so unauthenticated traffic cannot grow the cache. The
// cache is bounded per DID and globally and FAILS CLOSED when full (429 /
// 503): evicting a live nonce would reopen it to replay.
//
// What this does NOT give: confidentiality of who sends to whom from the
// relay (it now learns the sender DID by design), nor protection against a
// captured request being replayed to a DIFFERENT relay (the audience is not
// bound; the recipient's message-id dedup absorbs that). A signed sender is
// authentic, not authorised — see RelayServerOptions.isAllowedSender.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { resolveDidPeer, type Identity } from "./did_identity.js";

export const SEND_AUTH_HEADERS = {
  did: "x-tw-relay-did",
  ts: "x-tw-relay-ts",
  nonce: "x-tw-relay-nonce",
  sig: "x-tw-relay-sig",
} as const;

export const SEND_AUTH_PREFIX = "trustweb-relay-send/v1";
export const DEFAULT_SEND_AUTH_WINDOW_MS = 5 * 60_000;
const DEFAULT_MAX_NONCES_PER_DID = 1_000;
const DEFAULT_MAX_NONCES_TOTAL = 100_000;

const MAX_DID_LENGTH = 4096;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{86}$/; // 64 bytes, unpadded base64url
const TS_PATTERN = /^\d{1,16}$/;

export type SenderAuthMode = "required" | "optional" | "off";

/** Parses an operator setting (env RELAY_SENDER_AUTH). Unset -> "required"; anything unrecognised throws rather than silently weakening ingress. */
export function parseSenderAuthMode(value: string | undefined): SenderAuthMode {
  if (value === undefined || value === "") return "required";
  if (value === "required" || value === "optional" || value === "off") return value;
  throw new Error(`RELAY_SENDER_AUTH must be required|optional|off, got "${value}"`);
}

export type SendAuthHeaders = Record<string, string | string[] | undefined>;

export type SendAuthFailureCode = "missing_auth" | "malformed" | "stale" | "bad_signature" | "replayed" | "rate_limited" | "overloaded";

export type SendAuthResult =
  | { ok: true; did: string }
  | { ok: false; status: 401 | 429 | 503; code: SendAuthFailureCode };

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** The exact bytes a sender signs and the relay verifies. `wire` is the request body as sent. */
export function sendSigningInput(did: string, ts: string, nonce: string, wire: string): Uint8Array {
  const digest = hex(sha256(new TextEncoder().encode(wire)));
  return new TextEncoder().encode([SEND_AUTH_PREFIX, did, ts, nonce, digest].join("\n"));
}

/** Headers to attach to `POST /relay/send` for `wire`. Never throws for a well-formed identity. */
export function signSend(
  identity: Pick<Identity, "did" | "signing">,
  wire: string,
  opts: { now?: number; nonce?: string } = {}
): Record<string, string> {
  const ts = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? Buffer.from(randomBytes(16)).toString("base64url");
  const sig = ed25519.sign(sendSigningInput(identity.did, ts, nonce, wire), identity.signing.secretKey);
  return {
    [SEND_AUTH_HEADERS.did]: identity.did,
    [SEND_AUTH_HEADERS.ts]: ts,
    [SEND_AUTH_HEADERS.nonce]: nonce,
    [SEND_AUTH_HEADERS.sig]: Buffer.from(sig).toString("base64url"),
  };
}

export interface SendAuthVerifierOptions {
  /** Accepted clock skew / replay horizon in ms (both directions). Default 5 min. */
  windowMs?: number;
  /** Live nonces one DID may hold before further sends get 429. Default 1000. */
  maxNoncesPerDid?: number;
  /** Live nonces across all DIDs before further sends get 503. Default 100000. */
  maxNoncesTotal?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** Whether any of the four auth headers is present (lets "optional" mode tell "unsigned" from "badly signed"). */
export function hasSendAuthHeaders(headers: SendAuthHeaders): boolean {
  return Object.values(SEND_AUTH_HEADERS).some((h) => headers[h] !== undefined);
}

export class SendAuthVerifier {
  private readonly windowMs: number;
  private readonly maxPerDid: number;
  private readonly maxTotal: number;
  private readonly now: () => number;
  /** `${did}\n${nonce}` -> expiry (ms). */
  private readonly seen = new Map<string, { did: string; expiresAt: number }>();
  private readonly perDid = new Map<string, number>();
  private lastPrune = Number.NEGATIVE_INFINITY;

  constructor(opts: SendAuthVerifierOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_SEND_AUTH_WINDOW_MS;
    this.maxPerDid = opts.maxNoncesPerDid ?? DEFAULT_MAX_NONCES_PER_DID;
    this.maxTotal = opts.maxNoncesTotal ?? DEFAULT_MAX_NONCES_TOTAL;
    this.now = opts.now ?? Date.now;
  }

  /** Live (unexpired) nonces held. */
  size(): number {
    return this.seen.size;
  }

  /** Verify a send. Never throws. On success the nonce is consumed. */
  verify(wire: string, headers: SendAuthHeaders): SendAuthResult {
    if (Object.values(SEND_AUTH_HEADERS).some((h) => headers[h] === undefined)) return fail(401, "missing_auth");
    const did = single(headers[SEND_AUTH_HEADERS.did]);
    const ts = single(headers[SEND_AUTH_HEADERS.ts]);
    const nonce = single(headers[SEND_AUTH_HEADERS.nonce]);
    const sig = single(headers[SEND_AUTH_HEADERS.sig]);
    // a repeated header arrives as an array — not a usable credential
    if (did === undefined || ts === undefined || nonce === undefined || sig === undefined) return fail(401, "malformed");
    if (did.length === 0 || did.length > MAX_DID_LENGTH || !TS_PATTERN.test(ts) || !NONCE_PATTERN.test(nonce) || !SIG_PATTERN.test(sig)) {
      return fail(401, "malformed");
    }

    const now = this.now();
    if (Math.abs(now - Number(ts)) > this.windowMs) return fail(401, "stale");

    let ok = false;
    try {
      const { signingPublicKey } = resolveDidPeer(did);
      ok = ed25519.verify(new Uint8Array(Buffer.from(sig, "base64url")), sendSigningInput(did, ts, nonce, wire), signingPublicKey);
    } catch {
      ok = false;
    }
    if (!ok) return fail(401, "bad_signature");

    // Only a verified signature may touch the cache.
    if (now - this.lastPrune >= this.windowMs / 2) this.prune(now);
    const key = `${did}\n${nonce}`;
    if (this.seen.has(key)) return fail(401, "replayed");
    if ((this.perDid.get(did) ?? 0) >= this.maxPerDid) {
      this.prune(now);
      if ((this.perDid.get(did) ?? 0) >= this.maxPerDid) return fail(429, "rate_limited");
    }
    if (this.seen.size >= this.maxTotal) {
      this.prune(now);
      if (this.seen.size >= this.maxTotal) return fail(503, "overloaded");
    }
    this.seen.set(key, { did, expiresAt: Number(ts) + this.windowMs });
    this.perDid.set(did, (this.perDid.get(did) ?? 0) + 1);
    return { ok: true, did };
  }

  private prune(now: number): void {
    this.lastPrune = now;
    for (const [key, entry] of this.seen) {
      if (entry.expiresAt >= now) continue;
      this.seen.delete(key);
      const left = (this.perDid.get(entry.did) ?? 1) - 1;
      if (left <= 0) this.perDid.delete(entry.did);
      else this.perDid.set(entry.did, left);
    }
  }
}

function single(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function fail(status: 401 | 429 | 503, code: SendAuthFailureCode): SendAuthResult {
  return { ok: false, status, code };
}
