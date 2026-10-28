// relay_send_auth.test.ts — per-DID signature on POST /relay/send: valid,
// forged, replayed (plus stale / tampered / capped) sends against the pure
// verifier. Identities are freshly generated per test; nothing personal.
import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createIdentity } from "./did_identity.js";
import {
  SEND_AUTH_HEADERS,
  SendAuthVerifier,
  sendSigningInput,
  signSend,
} from "./relay_send_auth.js";

const WIRE = JSON.stringify({ typ: "x", alg: "y", epk: "e", nonce: "n", ciphertext: "c", to: "did:peer:2.recipient" });
const NOW = 1_800_000_000_000;

function setup(opts?: ConstructorParameters<typeof SendAuthVerifier>[0]) {
  const sender = createIdentity("http://127.0.0.1:1");
  const verifier = new SendAuthVerifier({ now: () => NOW, ...opts });
  return { sender, verifier };
}

describe("signSend / SendAuthVerifier — valid sends", () => {
  it("accepts a correctly signed send and reports the sender DID", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, headers)).toEqual({ ok: true, did: sender.did });
  });

  it("accepts node-style lower-cased, single-valued headers and a fresh nonce per call", () => {
    const { sender, verifier } = setup();
    const a = signSend(sender, WIRE, { now: NOW });
    const b = signSend(sender, WIRE, { now: NOW });
    expect(a[SEND_AUTH_HEADERS.nonce]).not.toBe(b[SEND_AUTH_HEADERS.nonce]);
    expect(verifier.verify(WIRE, a).ok).toBe(true);
    expect(verifier.verify(WIRE, b).ok).toBe(true); // same wire, new nonce: a legitimate resend
  });
});

describe("forged sends", () => {
  it("rejects a signature made by a different key claiming the victim's DID", () => {
    const { sender, verifier } = setup();
    const attacker = createIdentity("http://127.0.0.1:2");
    const headers = signSend({ did: sender.did, signing: attacker.signing }, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("rejects a valid signature presented under another DID", () => {
    const { sender, verifier } = setup();
    const other = createIdentity("http://127.0.0.1:3");
    const headers = { ...signSend(sender, WIRE, { now: NOW }), [SEND_AUTH_HEADERS.did]: other.did };
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a wire altered after signing", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { now: NOW });
    const tampered = WIRE.replace("recipient", "someoneelse");
    expect(verifier.verify(tampered, headers)).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a timestamp swapped after signing", () => {
    const { sender, verifier } = setup();
    const headers = { ...signSend(sender, WIRE, { now: NOW - 1000 }), [SEND_AUTH_HEADERS.ts]: String(NOW) };
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a signature over a different domain-separation prefix (e.g. a drain-auth nonce signature)", () => {
    const { sender, verifier } = setup();
    const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
    const sig = ed25519.sign(new TextEncoder().encode(nonce), sender.signing.secretKey);
    const headers = {
      [SEND_AUTH_HEADERS.did]: sender.did,
      [SEND_AUTH_HEADERS.ts]: String(NOW),
      [SEND_AUTH_HEADERS.nonce]: nonce,
      [SEND_AUTH_HEADERS.sig]: Buffer.from(sig).toString("base64url"),
    };
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects missing, partial, malformed and non-resolvable credentials without throwing", () => {
    const { sender, verifier } = setup();
    const good = signSend(sender, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, {})).toMatchObject({ ok: false, status: 401, code: "missing_auth" });
    for (const key of Object.values(SEND_AUTH_HEADERS)) {
      const partial = { ...good };
      delete partial[key];
      expect(verifier.verify(WIRE, partial)).toMatchObject({ ok: false, code: "missing_auth" });
    }
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.did]: "did:peer:2.garbage" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.sig]: "!!notbase64!!" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.ts]: "yesterday" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.did]: [sender.did, sender.did] })).toMatchObject({ ok: false, status: 401 });
  });
});

describe("replayed and stale sends", () => {
  it("rejects the exact same signed request the second time", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, headers).ok).toBe(true);
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, status: 401, code: "replayed" });
  });

  it("rejects a replay even when attacker-controlled time moves within the window", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:4");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 60_000 });
    const headers = signSend(sender, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, headers).ok).toBe(true);
    now = NOW + 59_000;
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, code: "replayed" });
  });

  it("rejects a capture replayed after the window (stale), and one dated in the future", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:5");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 60_000 });
    const old = signSend(sender, WIRE, { now: NOW });
    now = NOW + 60_001;
    expect(verifier.verify(WIRE, old)).toMatchObject({ ok: false, status: 401, code: "stale" });
    const future = signSend(sender, WIRE, { now: now + 60_001 });
    expect(verifier.verify(WIRE, future)).toMatchObject({ ok: false, code: "stale" });
  });

  it("does not remember a nonce from a send that failed verification (no cache poisoning)", () => {
    const { sender, verifier } = setup();
    const attacker = createIdentity("http://127.0.0.1:6");
    const forged = signSend({ did: sender.did, signing: attacker.signing }, WIRE, { now: NOW, nonce: "fixednonce0000000000a" });
    expect(verifier.verify(WIRE, forged).ok).toBe(false);
    const real = signSend(sender, WIRE, { now: NOW, nonce: "fixednonce0000000000a" });
    expect(verifier.verify(WIRE, real).ok).toBe(true);
  });

  it("forgets nonces once they age out, so the cache stays bounded", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:7");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 1_000 });
    for (let i = 0; i < 5; i++) verifier.verify(WIRE, signSend(sender, WIRE, { now }));
    expect(verifier.size()).toBe(5);
    now += 5_000;
    verifier.verify(WIRE, signSend(sender, WIRE, { now }));
    expect(verifier.size()).toBe(1);
  });

  it("fails closed (429) when one DID exceeds its live-nonce budget, and (503) when the global budget is spent", () => {
    const sender = createIdentity("http://127.0.0.1:8");
    const other = createIdentity("http://127.0.0.1:9");
    const verifier = new SendAuthVerifier({ now: () => NOW, maxNoncesPerDid: 2, maxNoncesTotal: 3 });
    expect(verifier.verify(WIRE, signSend(sender, WIRE, { now: NOW })).ok).toBe(true);
    expect(verifier.verify(WIRE, signSend(sender, WIRE, { now: NOW })).ok).toBe(true);
    expect(verifier.verify(WIRE, signSend(sender, WIRE, { now: NOW }))).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    expect(verifier.verify(WIRE, signSend(other, WIRE, { now: NOW })).ok).toBe(true);
    const third = createIdentity("http://127.0.0.1:10");
    expect(verifier.verify(WIRE, signSend(third, WIRE, { now: NOW }))).toMatchObject({ ok: false, status: 503, code: "overloaded" });
  });
});

describe("signing input", () => {
  it("is domain-separated and binds did, timestamp, nonce and the wire bytes", () => {
    const base = sendSigningInput("did:x", "1", "n", WIRE);
    expect(new TextDecoder().decode(base).startsWith("trustweb-relay-send/v1\n")).toBe(true);
    expect(sendSigningInput("did:y", "1", "n", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "2", "n", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "1", "m", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "1", "n", WIRE + " ")).not.toEqual(base);
  });
});
