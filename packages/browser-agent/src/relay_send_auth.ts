// relay_send_auth — browser-side signer for POST /relay/send (v2).
//
// REUSE DECISION: a port of packages/transport/src/relay_send_auth.ts's
// signSend/sendSigningInputV2, NOT an import — same reason as relay_client.ts
// (transport's barrel pulls node-only modules). The signed bytes MUST stay
// identical to transport's; relay_send_auth.test.ts compares them byte for
// byte and relay_client.test.ts sends through a real transport RelayServer
// that requires sender authentication.
//
// Signed bytes (UTF-8, "\n"-joined, exactly 7 lines):
//   "trustweb-relay-send/v2" \n did \n (kid or "") \n aud \n ts \n nonce \n hex(sha256(wire bytes))
// `aud` is the origin of the ingress URL (`new URL(url).origin`), which binds
// a captured request to the one relay it was meant for. `kid` names a device
// key the DID's root key granted (did_key_records.ts); when it is set the
// signature is made with that device key instead of the root key.
//
// v1 (unbound to any relay) is no longer produced here: nothing in this
// package needs it, and relays refuse it in "required" mode.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { toBase64url } from "./identity.js";
import type { BrowserIdentity } from "./identity.js";

export const SEND_AUTH_HEADERS = {
  did: "x-tw-relay-did",
  kid: "x-tw-relay-kid",
  aud: "x-tw-relay-aud",
  ts: "x-tw-relay-ts",
  nonce: "x-tw-relay-nonce",
  sig: "x-tw-relay-sig",
} as const;

export const SEND_AUTH_PREFIX = "trustweb-relay-send/v2";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The exact bytes signed for one v2 send; `wire` is the request body as sent. Byte-identical to transport's sendSigningInputV2. */
export function sendSigningInputV2(p: { did: string; kid?: string; aud: string; ts: string; nonce: string; wire: string }): Uint8Array {
  const digest = hex(sha256(new TextEncoder().encode(p.wire)));
  return new TextEncoder().encode([SEND_AUTH_PREFIX, p.did, p.kid ?? "", p.aud, p.ts, p.nonce, digest].join("\n"));
}

export interface SignSendOptions {
  /** Audience: the origin of the ingress URL this send is POSTed to. Required. */
  aud: string;
  /** Sender clock (ms epoch). Defaults to Date.now(). */
  now?: number;
  /** Override the random nonce (tests). */
  nonce?: string;
  /** Device key id (z6Mk… multibase public key). Requires `deviceSecretKey`. */
  kid?: string;
  /** The device's Ed25519 secret key, used instead of the identity's root key when `kid` is set. */
  deviceSecretKey?: Uint8Array;
}

/** Same misuse guard as transport's signSend: `aud` must be exactly an origin (what `new URL(url).origin` returns). */
function requireOrigin(aud: string | undefined): string {
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

/** Headers to attach to `POST /relay/send` for `wire`: fresh nonce, signed with the identity's DID key (or the granted device key). */
export function signSend(
  identity: Pick<BrowserIdentity, "did" | "signingSecretKey">,
  wire: string,
  opts: SignSendOptions
): Record<string, string> {
  const aud = requireOrigin(opts.aud);
  if (opts.kid !== undefined && opts.deviceSecretKey === undefined) {
    throw new Error("signSend: kid requires deviceSecretKey");
  }
  if (opts.deviceSecretKey !== undefined && opts.kid === undefined) {
    throw new Error("signSend: deviceSecretKey requires a kid (the device's public key id)");
  }
  const ts = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? toBase64url(randomBytes(16));
  const secretKey = opts.kid !== undefined ? opts.deviceSecretKey! : identity.signingSecretKey;
  const input = sendSigningInputV2({ did: identity.did, kid: opts.kid, aud, ts, nonce, wire });
  const sig = ed25519.sign(input, secretKey);
  return {
    [SEND_AUTH_HEADERS.did]: identity.did,
    ...(opts.kid !== undefined ? { [SEND_AUTH_HEADERS.kid]: opts.kid } : {}),
    [SEND_AUTH_HEADERS.aud]: aud,
    [SEND_AUTH_HEADERS.ts]: ts,
    [SEND_AUTH_HEADERS.nonce]: nonce,
    [SEND_AUTH_HEADERS.sig]: toBase64url(sig),
  };
}
