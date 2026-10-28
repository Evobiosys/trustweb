// The browser signer's output must be exactly what the relay verifies.
import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateIdentity, fromBase64url } from "./identity.js";
import { SEND_AUTH_HEADERS, sendSigningInput, signSend } from "./relay_send_auth.js";

describe("browser signSend", () => {
  it("signs sendSigningInput(did, ts, nonce, wire) with the identity's signing key", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const wire = '{"to":"did:peer:2.recipient"}';
    const h = signSend(id, wire, { now: 1_800_000_000_000, nonce: "nonce-0123456789abc" });
    expect(h[SEND_AUTH_HEADERS.did]).toBe(id.did);
    expect(h[SEND_AUTH_HEADERS.ts]).toBe("1800000000000");
    const input = sendSigningInput(id.did, "1800000000000", "nonce-0123456789abc", wire);
    expect(ed25519.verify(fromBase64url(h[SEND_AUTH_HEADERS.sig]), input, ed25519.getPublicKey(id.signingSecretKey))).toBe(true);
    expect(new TextDecoder().decode(input)).toMatch(/^trustweb-relay-send\/v1\n/);
  });

  it("uses a fresh nonce per call", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const a = signSend(id, "w");
    const b = signSend(id, "w");
    expect(a[SEND_AUTH_HEADERS.nonce]).not.toBe(b[SEND_AUTH_HEADERS.nonce]);
    expect(a[SEND_AUTH_HEADERS.nonce]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});
