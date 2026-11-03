// relay_send_auth — sender authentication for POST /relay/send (scheme v2).
//
// Ingress used to accept any wire from anyone: the outer envelope carries no
// sender, so the relay could not tell who was filling a recipient's queue.
// Every send now carries a detached Ed25519 signature in request headers. The
// wire body stays byte-identical, so submit() and the DIDComm layer are
// untouched.
//
//   x-tw-relay-did    sender DID (did:peer:2 — the root key resolves locally)
//   x-tw-relay-kid    OPTIONAL device key id: the device's Ed25519 public key,
//                     multibase base58btc multicodec ("z6Mk…", the same
//                     encoding as a did:peer:2 `V` element). Absent ⇒ the
//                     DID's root key signed.
//   x-tw-relay-aud    audience: the ORIGIN of the ingress URL the client
//                     posts to (`new URL(ingressUrl).origin`, e.g.
//                     "https://relay.example"). Its presence marks v2.
//   x-tw-relay-ts     sender clock, ms since epoch, decimal
//   x-tw-relay-nonce  16+ random bytes, base64url, unique per send
//   x-tw-relay-sig    base64url Ed25519 signature over sendSigningInputV2(...)
//
// Signed bytes (UTF-8, "\n"-joined, exactly 7 lines):
//   "trustweb-relay-send/v2" \n did \n kid-or-"" \n aud \n ts \n nonce \n hex(sha256(wire bytes))
// The fixed prefix domain-separates this from the drain handshake (which signs
// a bare server nonce) and from v1, so no signature can serve as another. The
// wire hash binds the body, hence the recipient in its outer `to`; `aud`
// binds the relay; `kid` binds which key the signer claims to hold.
//
// Threat model / what each piece buys:
// - Forgery: only the holder of the DID's root key, or of a device key the
//   relay's SendKeyPolicy says the DID granted, can produce a valid send.
// - Replay within the window: a send is valid only inside ±windowMs of the
//   relay's live clock AND only once — (did, nonce) is remembered in a
//   SendNonceStore until ts + windowMs. Nonces are stored only after the
//   signature verified, so unauthenticated traffic cannot grow the store. The
//   store is bounded per DID and globally and FAILS CLOSED when full
//   (429 / 503): evicting a live nonce would reopen it to replay.
// - Cross-relay replay (F1): v1 did not bind the relay, so a captured request
//   replayed verbatim to every other relay (and to a daemon's own /relay/send
//   mount). v2 signs `aud` and the relay refuses an aud that is not its own
//   (401 bad_audience). With `audiences` configured, aud must be one of them
//   (lower-cased compare). Without, the relay derives its identity from the
//   request's Host header and compares HOST ONLY (`new URL(aud).host`), not
//   the full origin: TLS usually terminates at a reverse proxy, so the
//   relay cannot know whether the client used http or https, nor reliably
//   which port the client saw. Host-only is therefore weaker — two relays
//   behind the same hostname on different schemes are not told apart, and a
//   proxy that rewrites Host breaks it. OPERATORS SHOULD SET `audiences`
//   (env RELAY_SENDER_AUTH_AUDIENCES) for strict origin matching.
// - Restart (F2): with a persistent SendNonceStore (SqliteSendNonceStore)
//   consumed nonces survive a relay restart instead of reopening the window.
// - Clock regression (F3): freshness is judged on the live clock, but pruning
//   uses a monotonic high-water mark (max of every clock reading) minus one
//   extra window of grace. So a relay clock that steps forward and is then
//   corrected backwards by up to windowMs never re-accepts a nonce it already
//   consumed: anything pruned had expired a full window before the highest
//   time ever seen, so it is stale on any clock within a window of that.
//   Cost: nonces live up to 2×windowMs, which counts against the budgets.
// - Key rotation / revocation / devices (F5/F6): key lookup goes through a
//   SendKeyPolicy hook (DidKeyRegistry implements it). The default policy
//   knows only the DID's own root key and no devices. The policy's refusal
//   codes (revoked / rotated / unknown_key / expired_key) surface as 401.
// - Legacy (F7): v1 signatures (no aud) are refused as 401 legacy_signature
//   unless the verifier is built with allowV1 (a transition switch).
//
// What this does NOT give: confidentiality of who sends to whom from the relay
// (it learns the sender DID by design); sender authenticity at all in the
// relay's "optional" mode (unsigned sends still pass there); protection
// against replay after a clock regression larger than windowMs, or after a
// restart when the in-memory store is used; strict origin binding when
// `audiences` is unset (host-only, see above); any limit on how many DIDs one
// party mints (per-DID budgets bound only honest senders — use
// RelayServerOptions.isAllowedSender and proxy rate limits); protection of
// the signing keys themselves. A signed sender is authentic, not authorised.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { resolveDidPeer, type Identity } from "./did_identity.js";
import { InMemorySendNonceStore, type SendNonceStore } from "./send_nonce_store.js";

export type { SendNonceStore } from "./send_nonce_store.js";

export const SEND_AUTH_HEADERS = {
  did: "x-tw-relay-did",
  kid: "x-tw-relay-kid",
  aud: "x-tw-relay-aud",
  ts: "x-tw-relay-ts",
  nonce: "x-tw-relay-nonce",
  sig: "x-tw-relay-sig",
} as const;

export const SEND_AUTH_PREFIX_V1 = "trustweb-relay-send/v1";
export const SEND_AUTH_PREFIX = "trustweb-relay-send/v2";
export const DEFAULT_SEND_AUTH_WINDOW_MS = 5 * 60_000;
const DEFAULT_MAX_NONCES_PER_DID = 1_000;
const DEFAULT_MAX_NONCES_TOTAL = 100_000;

const MAX_DID_LENGTH = 4096;
const MAX_AUD_LENGTH = 2048;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{86}$/; // 64 bytes, unpadded base64url
const TS_PATTERN = /^\d{1,16}$/;
const KID_PATTERN = /^z[1-9A-HJ-NP-Za-km-z]{32,64}$/; // multibase base58btc; an Ed25519 multicodec key is "z6Mk" + 44 chars

export type SenderAuthMode = "required" | "optional" | "off";

/** Parses an operator setting (env RELAY_SENDER_AUTH). Unset -> "optional" (transition); anything unrecognised throws rather than silently weakening ingress. */
export function parseSenderAuthMode(value: string | undefined): SenderAuthMode {
  if (value === undefined || value === "") return "optional";   // transition: verify signed sends, accept unsigned until every client signs; RELAY_SENDER_AUTH=required then
  if (value === "required" || value === "optional" || value === "off") return value;
  throw new Error(`RELAY_SENDER_AUTH must be required|optional|off, got "${value}"`);
}

/** Request headers as node delivers them: lower-case keys, `host` present over HTTP, repeated headers as arrays. */
export type SendAuthHeaders = Record<string, string | string[] | undefined>;

export type SendAuthFailureCode =
  | "missing_auth"
  | "malformed"
  | "stale"
  | "bad_signature"
  | "replayed"
  | "rate_limited"
  | "overloaded"
  | "bad_audience"
  | "legacy_signature"
  | "unknown_key"
  | "expired_key"
  | "revoked"
  | "rotated";

export type SendAuthResult =
  | { ok: true; did: string }
  | { ok: false; status: 401 | 429 | 503; code: SendAuthFailureCode };

/** Which public key may sign for (did, kid) at `now`. */
export type KeyLookup =
  | { ok: true; publicKey: Uint8Array }
  | { ok: false; code: "revoked" | "rotated" | "unknown_key" | "expired_key" };

/** Key-resolution hook: rotation, revocation and device grants live behind it (DidKeyRegistry implements it). */
export interface SendKeyPolicy {
  signingKeyFor(did: string, kid: string | undefined, now: number): KeyLookup;
}

/** No registry: the root key encoded in the did:peer:2 itself; no device keys; nothing is ever revoked or rotated. */
export const DEFAULT_KEY_POLICY: SendKeyPolicy = {
  signingKeyFor(did: string, kid: string | undefined): KeyLookup {
    if (kid !== undefined) return { ok: false, code: "unknown_key" };
    try {
      return { ok: true, publicKey: resolveDidPeer(did).signingPublicKey };
    } catch {
      return { ok: false, code: "unknown_key" };
    }
  },
};

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function wireDigest(wire: string): string {
  return hex(sha256(new TextEncoder().encode(wire)));
}

/** v1 signing input (no audience, no kid). Produced by nobody any more; verified only when `allowV1`. */
export function sendSigningInput(did: string, ts: string, nonce: string, wire: string): Uint8Array {
  return new TextEncoder().encode([SEND_AUTH_PREFIX_V1, did, ts, nonce, wireDigest(wire)].join("\n"));
}

/** v2 signing input: the exact bytes a sender signs and the relay verifies. `wire` is the request body as sent. */
export function sendSigningInputV2(p: { did: string; kid?: string; aud: string; ts: string; nonce: string; wire: string }): Uint8Array {
  return new TextEncoder().encode([SEND_AUTH_PREFIX, p.did, p.kid ?? "", p.aud, p.ts, p.nonce, wireDigest(p.wire)].join("\n"));
}

/** A signer that is not a full Identity. `kid` set ⇒ `secretKey` is that DEVICE's key, not the DID's root key. */
export interface SendSigner {
  did: string;
  secretKey: Uint8Array;
  kid?: string;
}

type SignerInput = Pick<Identity, "did" | "signing"> | SendSigner;

export interface SignSendOptions {
  /** REQUIRED: origin of the ingress URL, i.e. `new URL(ingressUrl).origin`. */
  aud: string;
  now?: number;
  nonce?: string;
  /** Device key id; requires `deviceSecretKey` (or a SendSigner carrying `kid`). */
  kid?: string;
  deviceSecretKey?: Uint8Array;
}

/**
 * Headers to attach to `POST /relay/send` for `wire` (v2). Throws on misuse — a
 * missing or non-origin `aud`, a kid without its device key, a device key
 * without a kid — so a caller can never silently produce an unbound (v1)
 * or self-contradicting signature.
 */
export function signSend(identity: SignerInput, wire: string, opts: SignSendOptions): Record<string, string> {
  const aud = requireOrigin(opts);
  const isSigner = "secretKey" in identity;
  const kid = opts.kid ?? (isSigner ? identity.kid : undefined);
  let secretKey: Uint8Array;
  if (opts.deviceSecretKey !== undefined) {
    if (kid === undefined) throw new Error("signSend: opts.deviceSecretKey requires a kid (the device's public key id)");
    secretKey = opts.deviceSecretKey;
  } else if (isSigner) {
    if (opts.kid !== undefined && identity.kid === undefined) {
      throw new Error("signSend: opts.kid requires opts.deviceSecretKey (or a SendSigner whose kid matches its secretKey)");
    }
    secretKey = identity.secretKey;
  } else {
    if (kid !== undefined) throw new Error("signSend: opts.kid requires opts.deviceSecretKey");
    secretKey = identity.signing.secretKey;
  }
  const ts = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? Buffer.from(randomBytes(16)).toString("base64url");
  const sig = ed25519.sign(sendSigningInputV2({ did: identity.did, kid, aud, ts, nonce, wire }), secretKey);
  const headers: Record<string, string> = {
    [SEND_AUTH_HEADERS.did]: identity.did,
    [SEND_AUTH_HEADERS.aud]: aud,
    [SEND_AUTH_HEADERS.ts]: ts,
    [SEND_AUTH_HEADERS.nonce]: nonce,
    [SEND_AUTH_HEADERS.sig]: Buffer.from(sig).toString("base64url"),
  };
  if (kid !== undefined) headers[SEND_AUTH_HEADERS.kid] = kid;
  return headers;
}

function requireOrigin(opts: SignSendOptions | undefined): string {
  const aud = opts?.aud;
  if (typeof aud !== "string" || aud === "") {
    throw new Error("signSend: opts.aud is required — pass the relay origin, new URL(ingressUrl).origin");
  }
  let origin: string;
  try {
    origin = new URL(aud).origin;
  } catch {
    throw new Error(`signSend: opts.aud must be a URL origin like "https://relay.example", got "${aud}"`);
  }
  if (origin !== aud) throw new Error(`signSend: opts.aud must be exactly an origin (${origin}), got "${aud}"`);
  return aud;
}

/** LEGACY v1 producer — only for tests that need a v1 signature (and allowV1 checks). Production clients sign v2. */
export function signSendV1(
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
  /**
   * This relay's own origins (e.g. ["https://relay.example"]). Set ⇒ aud must equal one of them (lower-cased).
   * Unset or empty ⇒ aud's host must equal the request's Host header (weaker; see the file header).
   */
  audiences?: string[];
  /** Accept v1 (audience-unbound) signatures. Default false → 401 legacy_signature. */
  allowV1?: boolean;
  /** Key resolution (rotation / revocation / device keys). Default DEFAULT_KEY_POLICY. */
  keyPolicy?: SendKeyPolicy;
  /** Consumed-nonce memory. Default a fresh InMemorySendNonceStore (lost on restart). */
  nonceStore?: SendNonceStore;
}

/** Whether any auth header is present (lets "optional" mode tell "unsigned" from "badly signed"). */
export function hasSendAuthHeaders(headers: SendAuthHeaders): boolean {
  return Object.values(SEND_AUTH_HEADERS).some((h) => headers[h] !== undefined);
}

const REQUIRED_HEADERS = [SEND_AUTH_HEADERS.did, SEND_AUTH_HEADERS.ts, SEND_AUTH_HEADERS.nonce, SEND_AUTH_HEADERS.sig] as const;

export class SendAuthVerifier {
  private readonly windowMs: number;
  private readonly maxPerDid: number;
  private readonly maxTotal: number;
  private readonly now: () => number;
  private readonly audiences: ReadonlySet<string> | undefined;
  private readonly allowV1: boolean;
  private readonly keyPolicy: SendKeyPolicy;
  private readonly store: SendNonceStore;
  /** Highest clock reading ever seen: pruning never moves backwards with the wall clock. */
  private highWater = Number.NEGATIVE_INFINITY;
  private lastPrune = Number.NEGATIVE_INFINITY;

  constructor(opts: SendAuthVerifierOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_SEND_AUTH_WINDOW_MS;
    this.maxPerDid = opts.maxNoncesPerDid ?? DEFAULT_MAX_NONCES_PER_DID;
    this.maxTotal = opts.maxNoncesTotal ?? DEFAULT_MAX_NONCES_TOTAL;
    this.now = opts.now ?? Date.now;
    this.audiences = opts.audiences && opts.audiences.length > 0 ? new Set(opts.audiences.map(normalizeAudience)) : undefined;
    this.allowV1 = opts.allowV1 ?? false;
    this.keyPolicy = opts.keyPolicy ?? DEFAULT_KEY_POLICY;
    this.store = opts.nonceStore ?? new InMemorySendNonceStore();
  }

  /** Remembered (not yet pruned) nonces. */
  size(): number {
    return this.store.total();
  }

  /** Verify a send. Never throws. On success the nonce is consumed. */
  verify(wire: string, headers: SendAuthHeaders): SendAuthResult {
    try {
      return this.verifyInner(wire, headers);
    } catch {
      // a throwing store / policy must not crash ingress or let the send through
      return fail(503, "overloaded");
    }
  }

  private verifyInner(wire: string, headers: SendAuthHeaders): SendAuthResult {
    // 1. presence — kid and aud are the only optional ones
    if (REQUIRED_HEADERS.some((h) => headers[h] === undefined)) return fail(401, "missing_auth");

    // 2. shape — a repeated header arrives as an array: not a usable credential
    const did = single(headers[SEND_AUTH_HEADERS.did]);
    const ts = single(headers[SEND_AUTH_HEADERS.ts]);
    const nonce = single(headers[SEND_AUTH_HEADERS.nonce]);
    const sig = single(headers[SEND_AUTH_HEADERS.sig]);
    if (did === undefined || ts === undefined || nonce === undefined || sig === undefined) return fail(401, "malformed");
    if (did.length === 0 || did.length > MAX_DID_LENGTH || !TS_PATTERN.test(ts) || !NONCE_PATTERN.test(nonce) || !SIG_PATTERN.test(sig)) {
      return fail(401, "malformed");
    }
    const rawKid = headers[SEND_AUTH_HEADERS.kid];
    const rawAud = headers[SEND_AUTH_HEADERS.aud];
    const kid = rawKid === undefined ? undefined : single(rawKid);
    const aud = rawAud === undefined ? undefined : single(rawAud);
    if (rawKid !== undefined && (kid === undefined || !KID_PATTERN.test(kid))) return fail(401, "malformed");
    if (rawAud !== undefined && (aud === undefined || aud.length === 0 || aud.length > MAX_AUD_LENGTH)) return fail(401, "malformed");

    // 3. freshness on the LIVE clock
    const now = this.now();
    if (Math.abs(now - Number(ts)) > this.windowMs) return fail(401, "stale");

    // 4. version + audience
    let signingInput: Uint8Array;
    if (aud === undefined) {
      if (kid !== undefined) return fail(401, "malformed"); // v1 has no device keys
      if (!this.allowV1) return fail(401, "legacy_signature");
      signingInput = sendSigningInput(did, ts, nonce, wire);
    } else {
      if (!this.audienceOk(aud, headers)) return fail(401, "bad_audience");
      signingInput = sendSigningInputV2({ did, kid, aud, ts, nonce, wire });
    }

    // 5. key lookup (rotation / revocation / device grants)
    let lookup: KeyLookup;
    try {
      lookup = this.keyPolicy.signingKeyFor(did, kid, now);
    } catch {
      lookup = { ok: false, code: "unknown_key" };
    }
    if (!lookup.ok) return fail(401, lookup.code);

    // 6. signature
    let ok = false;
    try {
      ok = ed25519.verify(new Uint8Array(Buffer.from(sig, "base64url")), signingInput, lookup.publicKey);
    } catch {
      ok = false;
    }
    if (!ok) return fail(401, "bad_signature");

    // 7. replay + budgets. Only a verified signature may touch the store.
    this.highWater = Math.max(this.highWater, now);
    if (this.highWater - this.lastPrune >= this.windowMs / 2) this.prune();
    if (this.store.has(did, nonce)) return fail(401, "replayed");
    if (this.store.countFor(did) >= this.maxPerDid) {
      this.prune();
      if (this.store.countFor(did) >= this.maxPerDid) return fail(429, "rate_limited");
    }
    if (this.store.total() >= this.maxTotal) {
      this.prune();
      if (this.store.total() >= this.maxTotal) return fail(503, "overloaded");
    }
    this.store.add(did, nonce, Number(ts) + this.windowMs);
    return { ok: true, did };
  }

  private audienceOk(aud: string, headers: SendAuthHeaders): boolean {
    if (this.audiences !== undefined) return this.audiences.has(aud.toLowerCase());
    // No configured audiences: fall back to the Host the request arrived with. Host-only on purpose — behind a
    // TLS-terminating proxy the scheme (and the client-facing port) are unknown here. Operators wanting a strict
    // origin match set `audiences`.
    const host = single(headers.host);
    if (host === undefined || host === "") return false;
    let url: URL;
    try {
      url = new URL(aud);
    } catch {
      return false;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.host === "") return false;
    return url.host === host.toLowerCase();
  }

  /**
   * Prune against the monotonic high-water clock minus one window of grace (see the file header, "Clock
   * regression"): a nonce leaves the store only once it is stale on every clock within windowMs of the
   * highest time this verifier has seen.
   */
  private prune(): void {
    this.lastPrune = this.highWater;
    this.store.prune(this.highWater - this.windowMs);
  }
}

function normalizeAudience(a: string): string {
  const trimmed = a.trim();
  try {
    const origin = new URL(trimmed).origin;
    if (origin !== "null") return origin.toLowerCase();
  } catch {
    // not a URL: compare as given, lower-cased
  }
  return trimmed.toLowerCase();
}

function single(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function fail(status: 401 | 429 | 503, code: SendAuthFailureCode): SendAuthResult {
  return { ok: false, status, code };
}
