// relay_send_auth.test.ts — per-DID signature on POST /relay/send (v2:
// audience-bound, optional device kid, pluggable key policy + nonce store):
// valid, forged, replayed, cross-relay, legacy, stale, capped and clock-
// regression sends against the pure verifier. Identities are freshly
// generated per test; hosts are 127.0.0.1 / example names; nothing personal.
import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58btc } from "multiformats/bases/base58";
import { createIdentity } from "./did_identity.js";
import {
  DEFAULT_KEY_POLICY,
  SEND_AUTH_HEADERS,
  SEND_AUTH_PREFIX,
  SEND_AUTH_PREFIX_V1,
  SendAuthVerifier,
  hasSendAuthHeaders,
  sendSigningInput,
  sendSigningInputV2,
  signSend,
  signSendV1,
  type KeyLookup,
  type SendKeyPolicy,
} from "./relay_send_auth.js";
import { InMemorySendNonceStore } from "./send_nonce_store.js";

const WIRE = JSON.stringify({ typ: "x", alg: "y", epk: "e", nonce: "n", ciphertext: "c", to: "did:peer:2.recipient" });
const NOW = 1_800_000_000_000;
const AUD = "http://127.0.0.1:4177";
const HOST = "127.0.0.1:4177";

type VerifierOpts = ConstructorParameters<typeof SendAuthVerifier>[0];

function setup(opts?: VerifierOpts) {
  const sender = createIdentity("http://127.0.0.1:1");
  const verifier = new SendAuthVerifier({ now: () => NOW, ...opts });
  return { sender, verifier };
}

/** Node-style request headers: lower-case keys, `host` present over HTTP. */
function req(headers: Record<string, string>, host: string | null = HOST): Record<string, string> {
  return host === null ? { ...headers } : { ...headers, host };
}

/** A device key encoded exactly like a did:peer:2 `V` element (multicodec ed25519-pub, base58btc, `z6Mk…`). */
function deviceKey() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const prefixed = new Uint8Array(2 + publicKey.length);
  prefixed.set([0xed, 0x01], 0);
  prefixed.set(publicKey, 2);
  return { secretKey, publicKey, kid: base58btc.encode(prefixed) };
}

/** Policy that knows exactly one device key for one DID; root keys resolve as DEFAULT_KEY_POLICY does. */
function devicePolicy(did: string, kid: string, publicKey: Uint8Array): SendKeyPolicy {
  return {
    signingKeyFor(d, k, now): KeyLookup {
      if (k === undefined) return DEFAULT_KEY_POLICY.signingKeyFor(d, undefined, now);
      return d === did && k === kid ? { ok: true, publicKey } : { ok: false, code: "unknown_key" };
    },
  };
}

describe("signSend / SendAuthVerifier — valid v2 sends", () => {
  it("accepts a v2 send whose audience matches the request Host (host-derived audience)", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { aud: AUD, now: NOW });
    expect(headers[SEND_AUTH_HEADERS.aud]).toBe(AUD);
    expect(headers[SEND_AUTH_HEADERS.kid]).toBeUndefined();
    expect(verifier.verify(WIRE, req(headers))).toEqual({ ok: true, did: sender.did });
  });

  it("accepts a v2 send whose audience is one of the configured audiences (case-insensitive), Host ignored", () => {
    const { sender, verifier } = setup({ audiences: ["https://Relay.Example", "http://127.0.0.1:4177"] });
    const headers = signSend(sender, WIRE, { aud: "https://relay.example", now: NOW });
    // behind a TLS-terminating proxy the Host header may be anything; configured audiences win
    expect(verifier.verify(WIRE, req(headers, "10.0.0.5:8080"))).toEqual({ ok: true, did: sender.did });
  });

  it("accepts node-style lower-cased, single-valued headers and a fresh nonce per call", () => {
    const { sender, verifier } = setup();
    const a = signSend(sender, WIRE, { aud: AUD, now: NOW });
    const b = signSend(sender, WIRE, { aud: AUD, now: NOW });
    expect(a[SEND_AUTH_HEADERS.nonce]).not.toBe(b[SEND_AUTH_HEADERS.nonce]);
    expect(verifier.verify(WIRE, req(a)).ok).toBe(true);
    expect(verifier.verify(WIRE, req(b)).ok).toBe(true); // same wire, new nonce: a legitimate resend
  });

  it("hasSendAuthHeaders sees any auth header, including aud/kid alone", () => {
    expect(hasSendAuthHeaders({ host: HOST })).toBe(false);
    expect(hasSendAuthHeaders({ [SEND_AUTH_HEADERS.aud]: AUD })).toBe(true);
    expect(hasSendAuthHeaders({ [SEND_AUTH_HEADERS.kid]: "z6Mk" })).toBe(true);
  });
});

describe("audience binding (cross-relay replay)", () => {
  it("rejects a captured request replayed verbatim to a different relay origin (401 bad_audience)", () => {
    const { sender } = setup();
    const captured = signSend(sender, WIRE, { aud: "https://relay-a.example", now: NOW });
    const relayA = new SendAuthVerifier({ now: () => NOW });
    const relayB = new SendAuthVerifier({ now: () => NOW });
    expect(relayA.verify(WIRE, req(captured, "relay-a.example")).ok).toBe(true);
    expect(relayB.verify(WIRE, req(captured, "relay-b.example"))).toEqual({ ok: false, status: 401, code: "bad_audience" });
    const relayC = new SendAuthVerifier({ now: () => NOW, audiences: ["https://relay-c.example"] });
    expect(relayC.verify(WIRE, req(captured, "relay-a.example"))).toEqual({ ok: false, status: 401, code: "bad_audience" });
  });

  it("rejects an aud header swapped after signing as bad_signature (aud is in the signed input)", () => {
    const { sender, verifier } = setup();
    const headers = { ...signSend(sender, WIRE, { aud: "https://relay-a.example", now: NOW }), [SEND_AUTH_HEADERS.aud]: AUD };
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("rejects with bad_audience when there is no Host header and no configured audiences", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { aud: AUD, now: NOW });
    expect(verifier.verify(WIRE, req(headers, null))).toEqual({ ok: false, status: 401, code: "bad_audience" });
  });

  it("rejects an unparseable aud as bad_audience, never throwing", () => {
    const { sender, verifier } = setup();
    const headers = { ...signSend(sender, WIRE, { aud: AUD, now: NOW }), [SEND_AUTH_HEADERS.aud]: "not a url" };
    expect(verifier.verify(WIRE, req(headers))).toEqual({ ok: false, status: 401, code: "bad_audience" });
  });
});

describe("legacy v1 signatures", () => {
  it("rejects a v1-signed send with 401 legacy_signature by default", () => {
    const { sender, verifier } = setup();
    const v1 = signSendV1(sender, WIRE, { now: NOW });
    expect(v1[SEND_AUTH_HEADERS.aud]).toBeUndefined();
    expect(verifier.verify(WIRE, req(v1))).toEqual({ ok: false, status: 401, code: "legacy_signature" });
  });

  it("accepts a v1-signed send only when allowV1 is set (still replay-protected)", () => {
    const { sender, verifier } = setup({ allowV1: true });
    const v1 = signSendV1(sender, WIRE, { now: NOW });
    expect(verifier.verify(WIRE, req(v1))).toEqual({ ok: true, did: sender.did });
    expect(verifier.verify(WIRE, req(v1))).toMatchObject({ ok: false, code: "replayed" });
  });

  it("rejects a kid header on a v1 send as malformed (v1 has no device keys)", () => {
    const { sender, verifier } = setup({ allowV1: true });
    const v1 = { ...signSendV1(sender, WIRE, { now: NOW }), [SEND_AUTH_HEADERS.kid]: deviceKey().kid };
    expect(verifier.verify(WIRE, req(v1))).toEqual({ ok: false, status: 401, code: "malformed" });
  });

  it("does not accept a v1 signature relabelled as v2 by adding an aud header", () => {
    const { sender, verifier } = setup({ allowV1: true });
    const relabelled = { ...signSendV1(sender, WIRE, { now: NOW }), [SEND_AUTH_HEADERS.aud]: AUD };
    expect(verifier.verify(WIRE, req(relabelled))).toMatchObject({ ok: false, code: "bad_signature" });
  });
});

describe("key policy (rotation / revocation / device keys)", () => {
  it("rejects a kid that the key policy does not know with 401 unknown_key (default policy knows no devices)", () => {
    const { sender, verifier } = setup();
    const dev = deviceKey();
    const headers = signSend(sender, WIRE, { aud: AUD, now: NOW, kid: dev.kid, deviceSecretKey: dev.secretKey });
    expect(verifier.verify(WIRE, req(headers))).toEqual({ ok: false, status: 401, code: "unknown_key" });
  });

  for (const code of ["revoked", "rotated", "expired_key"] as const) {
    it(`maps a key policy answer of ${code} to 401 ${code}`, () => {
      const policy: SendKeyPolicy = { signingKeyFor: () => ({ ok: false, code }) };
      const { sender, verifier } = setup({ keyPolicy: policy });
      const headers = signSend(sender, WIRE, { aud: AUD, now: NOW });
      expect(verifier.verify(WIRE, req(headers))).toEqual({ ok: false, status: 401, code });
    });
  }

  it("passes did, kid and the live clock to the key policy", () => {
    const calls: Array<[string, string | undefined, number]> = [];
    const policy: SendKeyPolicy = {
      signingKeyFor(did, kid, now) {
        calls.push([did, kid, now]);
        return DEFAULT_KEY_POLICY.signingKeyFor(did, kid, now);
      },
    };
    const { sender, verifier } = setup({ keyPolicy: policy });
    verifier.verify(WIRE, req(signSend(sender, WIRE, { aud: AUD, now: NOW })));
    expect(calls).toEqual([[sender.did, undefined, NOW]]);
  });

  it("verifies a device-signed send against the device key the policy returns; a root-signed send carrying that kid fails", () => {
    const sender = createIdentity("http://127.0.0.1:11");
    const dev = deviceKey();
    const verifier = new SendAuthVerifier({ now: () => NOW, keyPolicy: devicePolicy(sender.did, dev.kid, dev.publicKey) });

    const deviceSigned = signSend({ did: sender.did, secretKey: dev.secretKey, kid: dev.kid }, WIRE, { aud: AUD, now: NOW });
    expect(deviceSigned[SEND_AUTH_HEADERS.kid]).toBe(dev.kid);
    expect(verifier.verify(WIRE, req(deviceSigned))).toEqual({ ok: true, did: sender.did });

    // same via the Identity shape + deviceSecretKey
    const viaOpts = signSend(sender, WIRE, { aud: AUD, now: NOW, kid: dev.kid, deviceSecretKey: dev.secretKey });
    expect(verifier.verify(WIRE, req(viaOpts))).toEqual({ ok: true, did: sender.did });

    // root key signing under the device's kid: the policy hands back the device key, so the root signature cannot verify
    const rootUnderKid = signSend({ did: sender.did, secretKey: sender.signing.secretKey, kid: dev.kid }, WIRE, { aud: AUD, now: NOW });
    expect(verifier.verify(WIRE, req(rootUnderKid))).toEqual({ ok: false, status: 401, code: "bad_signature" });

    // and a device signature presented WITHOUT the kid is checked against the root key → fails
    const stripped = { ...deviceSigned };
    delete stripped[SEND_AUTH_HEADERS.kid];
    expect(verifier.verify(WIRE, req(stripped))).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a malformed kid header as malformed", () => {
    const { sender, verifier } = setup();
    const headers = { ...signSend(sender, WIRE, { aud: AUD, now: NOW }), [SEND_AUTH_HEADERS.kid]: "not-a-multibase key!" };
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, status: 401, code: "malformed" });
  });

  it("treats a key policy that throws as unknown_key, never throwing itself", () => {
    const policy: SendKeyPolicy = { signingKeyFor: () => { throw new Error("db down"); } };
    const { sender, verifier } = setup({ keyPolicy: policy });
    expect(verifier.verify(WIRE, req(signSend(sender, WIRE, { aud: AUD, now: NOW })))).toEqual({ ok: false, status: 401, code: "unknown_key" });
  });
});

describe("forged sends", () => {
  it("rejects a signature made by a different key claiming the victim's DID", () => {
    const { sender, verifier } = setup();
    const attacker = createIdentity("http://127.0.0.1:2");
    const headers = signSend({ did: sender.did, signing: attacker.signing }, WIRE, { aud: AUD, now: NOW });
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("rejects a valid signature presented under another DID", () => {
    const { sender, verifier } = setup();
    const other = createIdentity("http://127.0.0.1:3");
    const headers = { ...signSend(sender, WIRE, { aud: AUD, now: NOW }), [SEND_AUTH_HEADERS.did]: other.did };
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a wire altered after signing", () => {
    const { sender, verifier } = setup();
    const headers = signSend(sender, WIRE, { aud: AUD, now: NOW });
    const tampered = WIRE.replace("recipient", "someoneelse");
    expect(verifier.verify(tampered, req(headers))).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a timestamp swapped after signing", () => {
    const { sender, verifier } = setup();
    const headers = { ...signSend(sender, WIRE, { aud: AUD, now: NOW - 1000 }), [SEND_AUTH_HEADERS.ts]: String(NOW) };
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects a signature over a different domain-separation prefix (e.g. a drain-auth nonce signature)", () => {
    const { sender, verifier } = setup();
    const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
    const sig = ed25519.sign(new TextEncoder().encode(nonce), sender.signing.secretKey);
    const headers = {
      [SEND_AUTH_HEADERS.did]: sender.did,
      [SEND_AUTH_HEADERS.aud]: AUD,
      [SEND_AUTH_HEADERS.ts]: String(NOW),
      [SEND_AUTH_HEADERS.nonce]: nonce,
      [SEND_AUTH_HEADERS.sig]: Buffer.from(sig).toString("base64url"),
    };
    expect(verifier.verify(WIRE, req(headers))).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects missing, partial, malformed and non-resolvable credentials without throwing", () => {
    const { sender, verifier } = setup();
    const good = req(signSend(sender, WIRE, { aud: AUD, now: NOW }));
    expect(verifier.verify(WIRE, {})).toMatchObject({ ok: false, status: 401, code: "missing_auth" });
    for (const key of [SEND_AUTH_HEADERS.did, SEND_AUTH_HEADERS.ts, SEND_AUTH_HEADERS.nonce, SEND_AUTH_HEADERS.sig]) {
      const partial = { ...good };
      delete partial[key];
      expect(verifier.verify(WIRE, partial)).toMatchObject({ ok: false, code: "missing_auth" });
    }
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.did]: "did:peer:2.garbage" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.sig]: "!!notbase64!!" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.ts]: "yesterday" })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.did]: [sender.did, sender.did] })).toMatchObject({ ok: false, status: 401 });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.aud]: [AUD, AUD] })).toMatchObject({ ok: false, status: 401, code: "malformed" });
    expect(verifier.verify(WIRE, { ...good, [SEND_AUTH_HEADERS.aud]: "" })).toMatchObject({ ok: false, status: 401, code: "malformed" });
  });
});

describe("replayed and stale sends", () => {
  it("rejects the exact same signed request the second time", () => {
    const { sender, verifier } = setup();
    const headers = req(signSend(sender, WIRE, { aud: AUD, now: NOW }));
    expect(verifier.verify(WIRE, headers).ok).toBe(true);
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, status: 401, code: "replayed" });
  });

  it("rejects a replay even when attacker-controlled time moves within the window", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:4");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 60_000 });
    const headers = req(signSend(sender, WIRE, { aud: AUD, now: NOW }));
    expect(verifier.verify(WIRE, headers).ok).toBe(true);
    now = NOW + 59_000;
    expect(verifier.verify(WIRE, headers)).toMatchObject({ ok: false, code: "replayed" });
  });

  it("rejects a capture replayed after the window (stale), and one dated in the future", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:5");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 60_000 });
    const old = req(signSend(sender, WIRE, { aud: AUD, now: NOW }));
    now = NOW + 60_001;
    expect(verifier.verify(WIRE, old)).toMatchObject({ ok: false, status: 401, code: "stale" });
    const future = req(signSend(sender, WIRE, { aud: AUD, now: now + 60_001 }));
    expect(verifier.verify(WIRE, future)).toMatchObject({ ok: false, code: "stale" });
  });

  it("does not remember a nonce from a send that failed verification (no cache poisoning)", () => {
    const { sender, verifier } = setup();
    const attacker = createIdentity("http://127.0.0.1:6");
    const forged = signSend({ did: sender.did, signing: attacker.signing }, WIRE, { aud: AUD, now: NOW, nonce: "fixednonce0000000000a" });
    expect(verifier.verify(WIRE, req(forged)).ok).toBe(false);
    const wrongAud = signSend(sender, WIRE, { aud: "https://elsewhere.example", now: NOW, nonce: "fixednonce0000000000a" });
    expect(verifier.verify(WIRE, req(wrongAud)).ok).toBe(false);
    const real = signSend(sender, WIRE, { aud: AUD, now: NOW, nonce: "fixednonce0000000000a" });
    expect(verifier.verify(WIRE, req(real)).ok).toBe(true);
  });

  it("forgets nonces once they age out, so the cache stays bounded", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:7");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 1_000 });
    for (let i = 0; i < 5; i++) verifier.verify(WIRE, req(signSend(sender, WIRE, { aud: AUD, now })));
    expect(verifier.size()).toBe(5);
    now += 5_000;
    verifier.verify(WIRE, req(signSend(sender, WIRE, { aud: AUD, now })));
    expect(verifier.size()).toBe(1);
  });

  it("fails closed (429) when one DID exceeds its live-nonce budget, and (503) when the global budget is spent", () => {
    const sender = createIdentity("http://127.0.0.1:8");
    const other = createIdentity("http://127.0.0.1:9");
    const verifier = new SendAuthVerifier({ now: () => NOW, maxNoncesPerDid: 2, maxNoncesTotal: 3 });
    const sign = (id: typeof sender) => req(signSend(id, WIRE, { aud: AUD, now: NOW }));
    expect(verifier.verify(WIRE, sign(sender)).ok).toBe(true);
    expect(verifier.verify(WIRE, sign(sender)).ok).toBe(true);
    expect(verifier.verify(WIRE, sign(sender))).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    expect(verifier.verify(WIRE, sign(other)).ok).toBe(true);
    const third = createIdentity("http://127.0.0.1:10");
    expect(verifier.verify(WIRE, sign(third))).toMatchObject({ ok: false, status: 503, code: "overloaded" });
  });

  it("monotonic prune: a clock that jumps 100 s forward then 200 s back does not reopen a nonce accepted before the step", () => {
    let now = NOW;
    const sender = createIdentity("http://127.0.0.1:12");
    const filler = createIdentity("http://127.0.0.1:13");
    const verifier = new SendAuthVerifier({ now: () => now, windowMs: 150_000 });
    // signed 140 s before the relay's clock: expires (ts + window) at NOW + 10 s
    const early = req(signSend(sender, WIRE, { aud: AUD, now: NOW - 140_000 }));
    expect(verifier.verify(WIRE, early).ok).toBe(true);
    // clock steps forward 100 s; a later send triggers a prune there (early's ts is now outside the window → stale)
    now = NOW + 100_000;
    expect(verifier.verify(WIRE, req(signSend(filler, WIRE, { aud: AUD, now })))).toMatchObject({ ok: true });
    expect(verifier.verify(WIRE, early)).toMatchObject({ ok: false, code: "stale" });
    // clock steps back 200 s (NTP correction): early's ts is 40 s old again — inside the window on the live clock
    now = NOW - 100_000;
    expect(verifier.verify(WIRE, req(signSend(filler, WIRE, { aud: AUD, now })))).toMatchObject({ ok: true });
    expect(verifier.verify(WIRE, early)).toEqual({ ok: false, status: 401, code: "replayed" });
  });

  it("uses an injected nonce store: a (did, nonce) the store already holds is refused as replayed", () => {
    const sender = createIdentity("http://127.0.0.1:14");
    const store = new InMemorySendNonceStore();
    const nonce = "persistednonce0000000001";
    store.add(sender.did, nonce, NOW + 60_000); // e.g. accepted by this relay before a restart
    const verifier = new SendAuthVerifier({ now: () => NOW, nonceStore: store });
    const headers = req(signSend(sender, WIRE, { aud: AUD, now: NOW, nonce }));
    expect(verifier.verify(WIRE, headers)).toEqual({ ok: false, status: 401, code: "replayed" });
    // and an accepted send lands in that store
    const fresh = req(signSend(sender, WIRE, { aud: AUD, now: NOW }));
    expect(verifier.verify(WIRE, fresh).ok).toBe(true);
    expect(store.has(sender.did, fresh[SEND_AUTH_HEADERS.nonce]!)).toBe(true);
    expect(verifier.size()).toBe(2);
  });
});

describe("signing input", () => {
  it("v1 is domain-separated and binds did, timestamp, nonce and the wire bytes", () => {
    const base = sendSigningInput("did:x", "1", "n", WIRE);
    expect(SEND_AUTH_PREFIX_V1).toBe("trustweb-relay-send/v1");
    expect(new TextDecoder().decode(base).startsWith("trustweb-relay-send/v1\n")).toBe(true);
    expect(sendSigningInput("did:y", "1", "n", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "2", "n", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "1", "m", WIRE)).not.toEqual(base);
    expect(sendSigningInput("did:x", "1", "n", WIRE + " ")).not.toEqual(base);
  });

  it("v2 is exactly the 7 frozen lines and binds did, kid, aud, ts, nonce and the wire bytes", () => {
    const p = { did: "did:x", aud: AUD, ts: "1", nonce: "n", wire: "hello" };
    const text = new TextDecoder().decode(sendSigningInputV2(p));
    expect(SEND_AUTH_PREFIX).toBe("trustweb-relay-send/v2");
    expect(text).toBe(
      ["trustweb-relay-send/v2", "did:x", "", AUD, "1", "n", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"].join("\n")
    );
    const base = sendSigningInputV2(p);
    expect(sendSigningInputV2({ ...p, kid: "z6Mkdevice" })).not.toEqual(base);
    expect(sendSigningInputV2({ ...p, aud: "https://relay.example" })).not.toEqual(base);
    expect(sendSigningInputV2({ ...p, did: "did:y" })).not.toEqual(base);
    expect(sendSigningInputV2({ ...p, ts: "2" })).not.toEqual(base);
    expect(sendSigningInputV2({ ...p, nonce: "m" })).not.toEqual(base);
    expect(sendSigningInputV2({ ...p, wire: "hello " })).not.toEqual(base);
  });

  it("signSend without aud throws (fail loud, never silently signs v1)", () => {
    const sender = createIdentity("http://127.0.0.1:15");
    expect(() => signSend(sender, WIRE, {} as unknown as { aud: string })).toThrow(/aud/);
    expect(() => (signSend as unknown as (i: unknown, w: string) => unknown)(sender, WIRE)).toThrow(/aud/);
    expect(() => signSend(sender, WIRE, { aud: "" })).toThrow(/aud/);
    expect(() => signSend(sender, WIRE, { aud: "https://relay.example/relay/send" })).toThrow(/origin/);
  });

  it("signSend refuses a kid without a device secret key, and a device secret key without a kid", () => {
    const sender = createIdentity("http://127.0.0.1:16");
    const dev = deviceKey();
    expect(() => signSend(sender, WIRE, { aud: AUD, kid: dev.kid })).toThrow(/deviceSecretKey/);
    expect(() => signSend(sender, WIRE, { aud: AUD, deviceSecretKey: dev.secretKey })).toThrow(/kid/);
  });
});

describe("transition default (2026-10-28)", () => {
  it("parseSenderAuthMode defaults to optional so unsigned clients keep working until all sign", async () => {
    const { parseSenderAuthMode } = await import("./relay_send_auth.js");
    expect(parseSenderAuthMode(undefined)).toBe("optional");
    expect(parseSenderAuthMode("")).toBe("optional");
    expect(parseSenderAuthMode("required")).toBe("required");
  });
});
