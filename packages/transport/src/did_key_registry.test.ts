// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// DidKeyRegistry — one test per rule of the key-rotation / revocation / device-grant contract
// (relay send-auth hardening F5/F6). Generated identities and device keys only; no network.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createIdentity,
  decodeEd25519Multibase,
  encodeEd25519Multibase,
  resolveDidPeer,
  type Identity,
  type KeyPair,
} from "./did_identity.js";
import {
  DEFAULT_DEVICE_GRANT_MS,
  keyRecordSigningInput,
  parseKeyRecord,
  signDeviceGrant,
  signDeviceRevocation,
  signRevocation,
  signRotation,
} from "./did_key_records.js";
import { InMemoryDidKeyStore, SqliteDidKeyStore } from "./did_key_store.js";
import { DidKeyRegistry } from "./did_key_registry.js";

const T0 = 1_800_000_000_000;
let ids = 0;
function identity(): Identity {
  ids += 1;
  return createIdentity(`http://127.0.0.1:${4000 + ids}/didcomm`);
}
function deviceKey(): KeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}
function registry(now = T0): { reg: DidKeyRegistry; clock: { now: number } } {
  const clock = { now };
  return { reg: new DidKeyRegistry({ now: () => clock.now }), clock };
}
function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

const toClose: SqliteDidKeyStore[] = [];
afterEach(() => {
  for (const s of toClose.splice(0)) s.close();
});

describe("did_identity multibase helpers", () => {
  it("encodeEd25519Multibase is exactly the did:peer:2 V element, and decode inverts it", () => {
    const id = identity();
    const mb = encodeEd25519Multibase(id.signing.publicKey);
    expect(mb.startsWith("z6Mk")).toBe(true);
    expect(id.did.split(".")[1]).toBe(`V${mb}`);
    expect(decodeEd25519Multibase(mb)).toEqual(id.signing.publicKey);
    expect(resolveDidPeer(id.did).signingPublicKey).toEqual(id.signing.publicKey);
  });

  it("decodeEd25519Multibase rejects an X25519 (E element) key and a wrong length", () => {
    const id = identity();
    const eElement = id.did.split(".")[2]!.slice(1);
    expect(() => decodeEd25519Multibase(eElement)).toThrow();
    expect(() => decodeEd25519Multibase(encodeEd25519Multibase(new Uint8Array(31)))).toThrow();
  });
});

describe("did_key_records", () => {
  it("signing inputs use the exact prefixes and line orders", () => {
    const a = identity();
    const b = identity();
    const dev = deviceKey();
    const kid = encodeEd25519Multibase(dev.publicKey);
    const text = (r: Parameters<typeof keyRecordSigningInput>[0]) => new TextDecoder().decode(keyRecordSigningInput(r));
    expect(text(signRotation(a, b, T0))).toBe(`trustweb-did-rotate/v1\n${a.did}\n${b.did}\n${T0}`);
    expect(text(signRevocation(a, T0))).toBe(`trustweb-did-revoke/v1\n${a.did}\n${T0}`);
    const grant = signDeviceGrant(a, dev, { at: T0 });
    expect(grant.kid).toBe(kid);
    expect(grant.expiresAt).toBe(T0 + DEFAULT_DEVICE_GRANT_MS);
    expect(DEFAULT_DEVICE_GRANT_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(text(grant)).toBe(`trustweb-did-device/v1\n${a.did}\n${kid}\n${T0}\n${T0 + DEFAULT_DEVICE_GRANT_MS}`);
    expect(text(signDeviceRevocation(a, kid, T0))).toBe(`trustweb-did-device-revoke/v1\n${a.did}\n${kid}\n${T0}`);
  });

  it("signatures verify against the right keys (root sig, successorSig, kidSig)", () => {
    const a = identity();
    const b = identity();
    const dev = deviceKey();
    const rot = signRotation(a, b, T0);
    expect(ed25519.verify(Buffer.from(rot.sig, "base64url"), keyRecordSigningInput(rot), a.signing.publicKey)).toBe(true);
    expect(ed25519.verify(Buffer.from(rot.successorSig, "base64url"), keyRecordSigningInput(rot), b.signing.publicKey)).toBe(true);
    const grant = signDeviceGrant(a, dev, { at: T0 });
    expect(ed25519.verify(Buffer.from(grant.kidSig, "base64url"), keyRecordSigningInput(grant), dev.publicKey)).toBe(true);
  });

  it("parseKeyRecord: round-trips JSON; rejects malformed JSON, unknown type, non-did:peer:2, bad sig shape, expiresAt <= at", () => {
    const a = identity();
    const b = identity();
    const rot = signRotation(a, b, T0);
    expect(parseKeyRecord(JSON.parse(JSON.stringify(rot)))).toEqual(rot);
    expect(parseKeyRecord(JSON.stringify(rot))).toEqual(rot);
    expect(parseKeyRecord("{not json")).toBeNull();
    expect(parseKeyRecord(null)).toBeNull();
    expect(parseKeyRecord({ ...rot, type: "rename" })).toBeNull();
    expect(parseKeyRecord({ ...rot, did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" })).toBeNull();
    expect(parseKeyRecord({ ...rot, did: `${a.did}\nx` })).toBeNull();
    expect(parseKeyRecord({ ...rot, sig: "short" })).toBeNull();
    expect(parseKeyRecord({ ...rot, at: 1.5 })).toBeNull();
    expect(parseKeyRecord({ ...rot, at: "1" })).toBeNull();
    const grant = signDeviceGrant(a, deviceKey(), { at: T0 });
    expect(parseKeyRecord({ ...grant, expiresAt: T0 })).toBeNull();
    expect(parseKeyRecord({ ...grant, kid: "zNotAKey" })).toBeNull();
  });
});

describe("DidKeyRegistry — rotate", () => {
  it("accepts a rotation carrying both signatures", () => {
    const { reg } = registry();
    const a = identity();
    const b = identity();
    expect(reg.apply(signRotation(a, b, T0))).toEqual({ ok: true, applied: true });
    expect(reg.status(a.did)).toEqual({ state: "rotated", successorDid: b.did, at: T0 });
    expect(reg.status(b.did)).toEqual({ state: "active" });
  });

  it("a missing or forged successorSig is bad_signature: you cannot rotate INTO a key you do not hold", () => {
    const { reg } = registry();
    const a = identity();
    const victim = identity();
    const attacker = identity();
    const rot = signRotation(a, victim, T0);
    const { successorSig: _drop, ...missing } = rot;
    expect(reg.apply(missing)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    expect(reg.apply({ ...rot, successorSig: "" })).toEqual({ ok: false, status: 401, code: "bad_signature" });
    // the attacker signs the successor half with their own key
    const forged = { ...rot, successorSig: b64u(ed25519.sign(keyRecordSigningInput(rot), attacker.signing.secretKey)) };
    expect(reg.apply(forged)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    // and the old key's own signature is checked too
    const forgedOld = { ...rot, sig: b64u(ed25519.sign(keyRecordSigningInput(rot), attacker.signing.secretKey)) };
    expect(reg.apply(forgedOld)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    expect(reg.status(a.did).state).toBe("active");
  });

  it("after rotation the old DID's sends resolve `rotated` and the successor's resolve to its root key", () => {
    const { reg } = registry();
    const a = identity();
    const b = identity();
    expect(reg.signingKeyFor(a.did, undefined, T0)).toEqual({ ok: true, publicKey: a.signing.publicKey });
    reg.apply(signRotation(a, b, T0));
    expect(reg.signingKeyFor(a.did, undefined, T0)).toEqual({ ok: false, code: "rotated" });
    expect(reg.signingKeyFor(b.did, undefined, T0)).toEqual({ ok: true, publicKey: b.signing.publicKey });
  });

  it("chain A→B→C: canonical(A)=C, predecessors(C)=[B, A] (nearest first)", () => {
    const { reg } = registry();
    const [a, b, c] = [identity(), identity(), identity()];
    expect(reg.apply(signRotation(a, b, T0)).ok).toBe(true);
    expect(reg.apply(signRotation(b, c, T0 + 1)).ok).toBe(true);
    expect(reg.canonical(a.did)).toBe(c.did);
    expect(reg.canonical(b.did)).toBe(c.did);
    expect(reg.canonical(c.did)).toBe(c.did);
    expect(reg.predecessors(c.did)).toEqual([b.did, a.did]);
    expect(reg.predecessors(b.did)).toEqual([a.did]);
    expect(reg.predecessors(a.did)).toEqual([]);
  });

  it("a cycle (C→A after A→B→C) is 409 cycle; rotating into itself is 409 cycle", () => {
    const { reg } = registry();
    const [a, b, c] = [identity(), identity(), identity()];
    reg.apply(signRotation(a, b, T0));
    reg.apply(signRotation(b, c, T0));
    expect(reg.apply(signRotation(c, a, T0))).toEqual({ ok: false, status: 409, code: "cycle" });
    expect(reg.apply(signRotation(c, c, T0))).toEqual({ ok: false, status: 409, code: "cycle" });
    expect(reg.status(c.did).state).toBe("active");
  });

  it("a successor that is already rotated or revoked is 409 successor_unavailable", () => {
    const { reg } = registry();
    const [a, b, c, d, e] = [identity(), identity(), identity(), identity(), identity()];
    reg.apply(signRotation(b, c, T0)); // b is rotated
    expect(reg.apply(signRotation(a, b, T0))).toEqual({ ok: false, status: 409, code: "successor_unavailable" });
    reg.apply(signRevocation(e, T0)); // e is revoked
    expect(reg.apply(signRotation(d, e, T0))).toEqual({ ok: false, status: 409, code: "successor_unavailable" });
  });

  it("a rotated DID accepts no further records (401 rotated)", () => {
    const { reg } = registry();
    const [a, b, c] = [identity(), identity(), identity()];
    reg.apply(signRotation(a, b, T0));
    expect(reg.apply(signRotation(a, c, T0 + 1))).toEqual({ ok: false, status: 401, code: "rotated" });
    expect(reg.apply(signRevocation(a, T0 + 1))).toEqual({ ok: false, status: 401, code: "rotated" });
    expect(reg.apply(signDeviceGrant(a, deviceKey(), { at: T0 + 1 }))).toEqual({ ok: false, status: 401, code: "rotated" });
    expect(reg.canonical(a.did)).toBe(b.did);
  });
});

describe("DidKeyRegistry — revoke", () => {
  it("revoke: signingKeyFor → revoked; further rotate/grant from it → 401 revoked; it cannot be a successor", () => {
    const { reg } = registry();
    const [a, b, c] = [identity(), identity(), identity()];
    expect(reg.apply(signRevocation(a, T0))).toEqual({ ok: true, applied: true });
    expect(reg.status(a.did)).toEqual({ state: "revoked", at: T0 });
    expect(reg.signingKeyFor(a.did, undefined, T0)).toEqual({ ok: false, code: "revoked" });
    expect(reg.apply(signRotation(a, b, T0 + 1))).toEqual({ ok: false, status: 401, code: "revoked" });
    expect(reg.apply(signDeviceGrant(a, deviceKey(), { at: T0 + 1 }))).toEqual({ ok: false, status: 401, code: "revoked" });
    expect(reg.apply(signRevocation(a, T0 + 1))).toEqual({ ok: false, status: 401, code: "revoked" });
    expect(reg.apply(signRotation(c, a, T0 + 1))).toEqual({ ok: false, status: 409, code: "successor_unavailable" });
  });

  it("a revocation with a forged signature is bad_signature (nobody else can revoke your DID)", () => {
    const { reg } = registry();
    const a = identity();
    const attacker = identity();
    const rev = signRevocation(a, T0);
    const forged = { ...rev, sig: b64u(ed25519.sign(keyRecordSigningInput(rev), attacker.signing.secretKey)) };
    expect(reg.apply(forged)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    expect(reg.status(a.did).state).toBe("active");
  });
});

describe("DidKeyRegistry — time and idempotence", () => {
  it("a record dated beyond now + windowMs is 400 future_record; within the window it applies", () => {
    const { reg } = registry();
    const [a, b] = [identity(), identity()];
    expect(reg.apply(signRevocation(a, T0 + 5 * 60_000 + 1))).toEqual({ ok: false, status: 400, code: "future_record" });
    expect(reg.apply(signRotation(a, b, T0 + 5 * 60_000))).toEqual({ ok: true, applied: true });
    const custom = new DidKeyRegistry({ now: () => T0, windowMs: 1_000 });
    expect(custom.apply(signRevocation(identity(), T0 + 1_001))).toEqual({ ok: false, status: 400, code: "future_record" });
  });

  it("a record older than the stored state for the same subject is 409 stale_record", () => {
    const { reg } = registry();
    const a = identity();
    const dev = deviceKey();
    expect(reg.apply(signDeviceGrant(a, dev, { at: T0 })).ok).toBe(true);
    expect(reg.apply(signDeviceGrant(a, dev, { at: T0 - 1_000 }))).toEqual({ ok: false, status: 409, code: "stale_record" });
    expect(reg.apply(signDeviceRevocation(a, encodeEd25519Multibase(dev.publicKey), T0 - 1))).toEqual({
      ok: false,
      status: 409,
      code: "stale_record",
    });
    // a newer grant renews the device key
    expect(reg.apply(signDeviceGrant(a, dev, { at: T0 + 10, expiresAt: T0 + 20_000 }))).toEqual({ ok: true, applied: true });
    expect(reg.deviceKeys(a.did)).toEqual([{ kid: encodeEd25519Multibase(dev.publicKey), expiresAt: T0 + 20_000 }]);
  });

  it("the identical record twice is { ok: true, applied: false } the second time", () => {
    const { reg } = registry();
    const [a, b, c] = [identity(), identity(), identity()];
    const dev = deviceKey();
    const rot = signRotation(a, b, T0);
    expect(reg.apply(rot)).toEqual({ ok: true, applied: true });
    expect(reg.apply(JSON.parse(JSON.stringify(rot)))).toEqual({ ok: true, applied: false });
    const rev = signRevocation(c, T0);
    expect(reg.apply(rev)).toEqual({ ok: true, applied: true });
    expect(reg.apply(rev)).toEqual({ ok: true, applied: false });
    const grant = signDeviceGrant(b, dev, { at: T0 });
    expect(reg.apply(grant)).toEqual({ ok: true, applied: true });
    expect(reg.apply(grant)).toEqual({ ok: true, applied: false });
    const drev = signDeviceRevocation(b, grant.kid, T0 + 1);
    expect(reg.apply(drev)).toEqual({ ok: true, applied: true });
    expect(reg.apply(drev)).toEqual({ ok: true, applied: false });
  });
});

describe("DidKeyRegistry — device keys", () => {
  it("a device_grant with proof of possession makes the device key resolve for that kid", () => {
    const { reg } = registry();
    const a = identity();
    const dev = deviceKey();
    const grant = signDeviceGrant(a, dev, { at: T0 });
    expect(reg.signingKeyFor(a.did, grant.kid, T0)).toEqual({ ok: false, code: "unknown_key" });
    expect(reg.apply(grant)).toEqual({ ok: true, applied: true });
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 1)).toEqual({ ok: true, publicKey: dev.publicKey });
    expect(reg.signingKeyFor(a.did, undefined, T0 + 1)).toEqual({ ok: true, publicKey: a.signing.publicKey });
    expect(reg.deviceKeys(a.did)).toEqual([{ kid: grant.kid, expiresAt: T0 + DEFAULT_DEVICE_GRANT_MS }]);
  });

  it("a grant without kidSig, a forged kidSig or a forged root sig is bad_signature", () => {
    const { reg } = registry();
    const a = identity();
    const attacker = identity();
    const dev = deviceKey();
    const grant = signDeviceGrant(a, dev, { at: T0 });
    const { kidSig: _drop, ...missing } = grant;
    expect(reg.apply(missing)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    // claiming someone else's public key as your device: no proof of possession
    const other = deviceKey();
    const forgedKid = { ...grant, kidSig: b64u(ed25519.sign(keyRecordSigningInput(grant), other.secretKey)) };
    expect(reg.apply(forgedKid)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    const forgedRoot = { ...grant, sig: b64u(ed25519.sign(keyRecordSigningInput(grant), attacker.signing.secretKey)) };
    expect(reg.apply(forgedRoot)).toEqual({ ok: false, status: 401, code: "bad_signature" });
    expect(reg.deviceKeys(a.did)).toEqual([]);
  });

  it("an expired grant resolves expired_key", () => {
    const { reg } = registry();
    const a = identity();
    const grant = signDeviceGrant(a, deviceKey(), { at: T0, expiresAt: T0 + 1_000 });
    expect(reg.apply(grant).ok).toBe(true);
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 999).ok).toBe(true);
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 1_000)).toEqual({ ok: false, code: "expired_key" });
  });

  it("device_revoke makes the kid resolve revoked; it is terminal for that kid", () => {
    const { reg } = registry();
    const a = identity();
    const dev = deviceKey();
    const grant = signDeviceGrant(a, dev, { at: T0 });
    reg.apply(grant);
    expect(reg.apply(signDeviceRevocation(a, grant.kid, T0 + 5))).toEqual({ ok: true, applied: true });
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 6)).toEqual({ ok: false, code: "revoked" });
    expect(reg.deviceKeys(a.did)).toEqual([{ kid: grant.kid, expiresAt: T0 + DEFAULT_DEVICE_GRANT_MS, revokedAt: T0 + 5 }]);
    expect(reg.apply(signDeviceGrant(a, dev, { at: T0 + 10 }))).toEqual({ ok: false, status: 401, code: "revoked" });
    // the root key is untouched
    expect(reg.signingKeyFor(a.did, undefined, T0 + 6).ok).toBe(true);
  });

  it("a device_revoke for an unknown kid is 409 unknown_grant", () => {
    const { reg } = registry();
    const a = identity();
    const kid = encodeEd25519Multibase(deviceKey().publicKey);
    expect(reg.apply(signDeviceRevocation(a, kid, T0))).toEqual({ ok: false, status: 409, code: "unknown_grant" });
  });

  it("a device_revoke must be signed by the DID's root key, not by the device", () => {
    const { reg } = registry();
    const a = identity();
    const dev = deviceKey();
    const grant = signDeviceGrant(a, dev, { at: T0 });
    reg.apply(grant);
    const rev = signDeviceRevocation(a, grant.kid, T0 + 1);
    const byDevice = { ...rev, sig: b64u(ed25519.sign(keyRecordSigningInput(rev), dev.secretKey)) };
    expect(reg.apply(byDevice)).toEqual({ ok: false, status: 401, code: "bad_signature" });
  });

  it("grants die with rotation: the old DID resolves rotated, the successor must re-grant", () => {
    const { reg } = registry();
    const [a, b] = [identity(), identity()];
    const dev = deviceKey();
    const grant = signDeviceGrant(a, dev, { at: T0 });
    reg.apply(grant);
    reg.apply(signRotation(a, b, T0 + 1));
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 2)).toEqual({ ok: false, code: "rotated" });
    expect(reg.signingKeyFor(b.did, grant.kid, T0 + 2)).toEqual({ ok: false, code: "unknown_key" });
    expect(reg.apply(signDeviceGrant(b, dev, { at: T0 + 3 }))).toEqual({ ok: true, applied: true });
    expect(reg.signingKeyFor(b.did, grant.kid, T0 + 4)).toEqual({ ok: true, publicKey: dev.publicKey });
  });

  it("a revoked DID's device keys resolve revoked", () => {
    const { reg } = registry();
    const a = identity();
    const grant = signDeviceGrant(a, deviceKey(), { at: T0 });
    reg.apply(grant);
    reg.apply(signRevocation(a, T0 + 1));
    expect(reg.signingKeyFor(a.did, grant.kid, T0 + 2)).toEqual({ ok: false, code: "revoked" });
  });
});

describe("DidKeyRegistry — malformed input never throws", () => {
  it("malformed JSON, wrong type, non-did:peer:2 subject → 400 malformed", () => {
    const { reg } = registry();
    const a = identity();
    const b = identity();
    expect(reg.apply("{nope")).toEqual({ ok: false, status: 400, code: "malformed" });
    expect(reg.apply(undefined)).toEqual({ ok: false, status: 400, code: "malformed" });
    expect(reg.apply(42)).toEqual({ ok: false, status: 400, code: "malformed" });
    expect(reg.apply({ ...signRevocation(a, T0), type: "nuke" })).toEqual({ ok: false, status: 400, code: "malformed" });
    expect(reg.apply({ ...signRotation(a, b, T0), successorDid: "did:web:example.com" })).toEqual({
      ok: false,
      status: 400,
      code: "malformed",
    });
    expect(reg.apply(JSON.stringify(signRevocation(a, T0)))).toEqual({ ok: true, applied: true });
  });

  it("signingKeyFor a non-did:peer:2 DID is unknown_key, never a throw", () => {
    const { reg } = registry();
    expect(reg.signingKeyFor("did:web:example.com", undefined, T0)).toEqual({ ok: false, code: "unknown_key" });
    expect(reg.signingKeyFor("did:web:example.com", "z6Mk", T0)).toEqual({ ok: false, code: "unknown_key" });
  });
});

describe("DidKeyStore", () => {
  it("InMemoryDidKeyStore backs a registry by default and can be passed explicitly", () => {
    const store = new InMemoryDidKeyStore();
    const reg = new DidKeyRegistry({ store, now: () => T0 });
    const [a, b] = [identity(), identity()];
    reg.apply(signRotation(a, b, T0));
    expect(new DidKeyRegistry({ store, now: () => T0 }).canonical(a.did)).toBe(b.did);
  });

  it("SqliteDidKeyStore round-trips rotation, revocation and device grants through close + reopen", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "did-key-store-")), "keys.db");
    const [a, b, c, r] = [identity(), identity(), identity(), identity()];
    const dev = deviceKey();
    const dev2 = deviceKey();
    const first = new SqliteDidKeyStore(dbPath);
    const reg1 = new DidKeyRegistry({ store: first, now: () => T0 + 100 });
    expect(reg1.apply(signRotation(a, b, T0)).ok).toBe(true);
    expect(reg1.apply(signRotation(b, c, T0 + 1)).ok).toBe(true);
    expect(reg1.apply(signRevocation(r, T0)).ok).toBe(true);
    const grant = signDeviceGrant(c, dev, { at: T0 + 2 });
    const grant2 = signDeviceGrant(c, dev2, { at: T0 + 2 });
    expect(reg1.apply(grant).ok).toBe(true);
    expect(reg1.apply(grant2).ok).toBe(true);
    expect(reg1.apply(signDeviceRevocation(c, grant2.kid, T0 + 3)).ok).toBe(true);
    first.close();

    const second = new SqliteDidKeyStore(dbPath);
    toClose.push(second);
    const reg2 = new DidKeyRegistry({ store: second, now: () => T0 + 100 });
    expect(reg2.canonical(a.did)).toBe(c.did);
    expect(reg2.predecessors(c.did)).toEqual([b.did, a.did]);
    expect(reg2.status(r.did)).toEqual({ state: "revoked", at: T0 });
    expect(reg2.signingKeyFor(c.did, grant.kid, T0 + 4)).toEqual({ ok: true, publicKey: dev.publicKey });
    expect(reg2.signingKeyFor(c.did, grant2.kid, T0 + 4)).toEqual({ ok: false, code: "revoked" });
    expect(reg2.apply(grant)).toEqual({ ok: true, applied: false });
    expect(reg2.apply(signRotation(c, a, T0 + 5))).toEqual({ ok: false, status: 409, code: "cycle" });
    expect(
      reg2
        .deviceKeys(c.did)
        .map((k) => k.kid)
        .sort()
    ).toEqual([grant.kid, grant2.kid].sort());
  });
});
