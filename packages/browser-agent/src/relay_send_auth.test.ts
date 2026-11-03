// The browser signer's output must be exactly what the relay verifies.
import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sendSigningInputV2 as transportSendSigningInputV2 } from "@resource-web/transport";
import { generateIdentity, fromBase64url } from "./identity.js";
import { SEND_AUTH_HEADERS, sendSigningInputV2, signSend } from "./relay_send_auth.js";

const AUD = "http://127.0.0.1:4177";

describe("browser signSend (v2)", () => {
  it("signs sendSigningInputV2(did, '', aud, ts, nonce, wire) with the identity's signing key", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const wire = '{"to":"did:peer:2.recipient"}';
    const h = signSend(id, wire, { aud: AUD, now: 1_800_000_000_000, nonce: "nonce-0123456789abc" });
    expect(h[SEND_AUTH_HEADERS.did]).toBe(id.did);
    expect(h[SEND_AUTH_HEADERS.aud]).toBe(AUD);
    expect(h[SEND_AUTH_HEADERS.ts]).toBe("1800000000000");
    expect(h[SEND_AUTH_HEADERS.nonce]).toBe("nonce-0123456789abc");
    expect(SEND_AUTH_HEADERS.kid in h).toBe(false);
    const input = sendSigningInputV2({ did: id.did, aud: AUD, ts: "1800000000000", nonce: "nonce-0123456789abc", wire });
    expect(ed25519.verify(fromBase64url(h[SEND_AUTH_HEADERS.sig]!), input, ed25519.getPublicKey(id.signingSecretKey))).toBe(true);
    const text = new TextDecoder().decode(input);
    expect(text.startsWith("trustweb-relay-send/v2\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(7);
    expect(text.split("\n")[2]).toBe(""); // no kid
  });

  it("produces exactly the bytes transport's sendSigningInputV2 produces (root key and device key)", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const wire = '{"to":"did:peer:2.recipient","ciphertext":"äöü-€"}';
    const base = { did: id.did, aud: "https://relay.example", ts: "1800000000123", nonce: "AAAAAAAAAAAAAAAAAAAAAA", wire };
    expect(Array.from(sendSigningInputV2(base))).toEqual(Array.from(transportSendSigningInputV2(base)));
    const withKid = { ...base, kid: "z6MkexampleDeviceKeyId" };
    expect(Array.from(sendSigningInputV2(withKid))).toEqual(Array.from(transportSendSigningInputV2(withKid)));
  });

  it("signs with the device key and sends its kid when one is given", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const deviceSecretKey = ed25519.utils.randomSecretKey();
    const kid = "z6MkexampleDeviceKeyId";
    const h = signSend(id, "w", { aud: AUD, kid, deviceSecretKey, now: 1_800_000_000_000, nonce: "nonce-0123456789abc" });
    expect(h[SEND_AUTH_HEADERS.kid]).toBe(kid);
    const input = sendSigningInputV2({ did: id.did, kid, aud: AUD, ts: "1800000000000", nonce: "nonce-0123456789abc", wire: "w" });
    const sig = fromBase64url(h[SEND_AUTH_HEADERS.sig]!);
    expect(ed25519.verify(sig, input, ed25519.getPublicKey(deviceSecretKey))).toBe(true);
    expect(ed25519.verify(sig, input, ed25519.getPublicKey(id.signingSecretKey))).toBe(false);
  });

  it("refuses a kid without the device secret key", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    expect(() => signSend(id, "w", { aud: AUD, kid: "z6MkexampleDeviceKeyId" })).toThrow(/deviceSecretKey/);
  });

  it("refuses a missing or non-origin aud, and a device key without its kid", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    expect(() => signSend(id, "w", { aud: "" })).toThrow(/aud/);
    expect(() => signSend(id, "w", { aud: "https://relay.example/relay/send" })).toThrow(/origin/);
    expect(() => signSend(id, "w", { aud: "HTTPS://Relay.Example" })).toThrow(/origin/);
    expect(() => signSend(id, "w", { aud: AUD, deviceSecretKey: ed25519.utils.randomSecretKey() })).toThrow(/kid/);
  });

  it("uses a fresh nonce per call", () => {
    const id = generateIdentity({ endpoint: "http://127.0.0.1:1" });
    const a = signSend(id, "w", { aud: AUD });
    const b = signSend(id, "w", { aud: AUD });
    expect(a[SEND_AUTH_HEADERS.nonce]).not.toBe(b[SEND_AUTH_HEADERS.nonce]);
    expect(a[SEND_AUTH_HEADERS.nonce]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});
