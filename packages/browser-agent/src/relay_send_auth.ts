// relay_send_auth — browser-side signer for POST /relay/send.
//
// REUSE DECISION: a port of packages/transport/src/relay_send_auth.ts's
// signSend/sendSigningInput, NOT an import — same reason as relay_client.ts
// (transport's barrel pulls node-only modules). The signed bytes MUST stay
// identical to transport's; relay_client.test.ts proves it by sending through
// a real transport RelayServer that requires sender authentication.
//
//   "trustweb-relay-send/v1" \n did \n ts \n nonce \n hex(sha256(wire bytes))
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { toBase64url } from "./identity.js";
import type { BrowserIdentity } from "./identity.js";

export const SEND_AUTH_HEADERS = {
  did: "x-tw-relay-did",
  ts: "x-tw-relay-ts",
  nonce: "x-tw-relay-nonce",
  sig: "x-tw-relay-sig",
} as const;

const SEND_AUTH_PREFIX = "trustweb-relay-send/v1";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The exact bytes signed for one send; `wire` is the request body as sent. */
export function sendSigningInput(did: string, ts: string, nonce: string, wire: string): Uint8Array {
  const digest = hex(sha256(new TextEncoder().encode(wire)));
  return new TextEncoder().encode([SEND_AUTH_PREFIX, did, ts, nonce, digest].join("\n"));
}

/** Headers to attach to `POST /relay/send` for `wire`: fresh nonce, signed with the identity's DID key. */
export function signSend(
  identity: Pick<BrowserIdentity, "did" | "signingSecretKey">,
  wire: string,
  opts: { now?: number; nonce?: string } = {}
): Record<string, string> {
  const ts = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? toBase64url(randomBytes(16));
  const sig = ed25519.sign(sendSigningInput(identity.did, ts, nonce, wire), identity.signingSecretKey);
  return {
    [SEND_AUTH_HEADERS.did]: identity.did,
    [SEND_AUTH_HEADERS.ts]: ts,
    [SEND_AUTH_HEADERS.nonce]: nonce,
    [SEND_AUTH_HEADERS.sig]: toBase64url(sig),
  };
}
