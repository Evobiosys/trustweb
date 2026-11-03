// Real RelayServer over real localhost HTTP (+ WS for the drain): POST /relay/send must carry a valid v2 per-DID
// signature bound to THIS relay's audience. Forged, replayed, cross-relay-replayed, v1, stale, unsigned and valid
// sends; the nonce store surviving a restart; key rotation / revocation / device keys through POST /relay/keys,
// for both send auth and drain auth; the staged-rollout "optional" mode and the allow-list hook. Fresh generated
// identities only.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createIdentity, type Identity, type KeyPair } from "./did_identity.js";
import { packMessage } from "./didcomm_crypto.js";
import { ENVELOPE_TYPE } from "./didcomm_transport.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import { RelayServer, type RelayServerOptions } from "./relay_server.js";
import { InMemoryRelayQueueStore } from "./relay_queue_store.js";
import { SEND_AUTH_HEADERS, signSend, signSendV1 } from "./relay_send_auth.js";
import { SqliteSendNonceStore } from "./send_nonce_store.js";
import { DidKeyRegistry } from "./did_key_registry.js";
import { signDeviceGrant, signDeviceRevocation, signRevocation, signRotation, keyRecordSigningInput } from "./did_key_records.js";

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];
const sqlite: SqliteSendNonceStore[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const s of sqlite.splice(0)) s.close();
});

async function boot(opts?: RelayServerOptions) {
  const queueStore = new InMemoryRelayQueueStore();
  const relay = new RelayServer({ queueStore, senderAuth: "required", ...opts }); // these tests pin the strict mode; the server default is "optional" during the transition
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, port, queueStore, aud: `http://127.0.0.1:${port}` };
}

function wireFor(sender: Identity, recipient: Identity, id = "m1"): string {
  return packMessage({
    sender,
    recipientDid: recipient.did,
    message: { id, type: ENVELOPE_TYPE, from: sender.did, to: [recipient.did], created_time: Date.now(), body: ENVELOPE_FIXTURES[0] },
  });
}

async function post(port: number, wire: string, headers: Record<string, string> = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: wire, headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, date: res.headers.get("date") };
}

async function postKey(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/relay/keys`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function deviceKey(): KeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

// ---- drain helpers (same protocol as relay_server.test.ts) ----

interface DrainMessage {
  type: string;
  [k: string]: unknown;
}

function openDrain(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/drain`);
  sockets.push(ws);
  const messages: DrainMessage[] = [];
  let closed = false;
  let resolveChallenge!: (nonce: string) => void;
  const challenge = new Promise<string>((resolve) => {
    resolveChallenge = resolve;
  });
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as DrainMessage;
    messages.push(msg);
    if (msg.type === "challenge") resolveChallenge(msg.nonce as string);
  });
  ws.on("close", () => {
    closed = true;
  });
  return { ws, messages, challenge, isClosed: () => closed };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Authenticate as `did`, signing the challenge with `secretKey` (root key, or a device key when `kid` is given). */
async function authenticate(drain: ReturnType<typeof openDrain>, did: string, secretKey: Uint8Array, kid?: string): Promise<DrainMessage> {
  const nonce = await drain.challenge;
  const sig = ed25519.sign(new Uint8Array(Buffer.from(nonce, "base64url")), secretKey);
  drain.ws.send(JSON.stringify({ type: "auth", did, sig: Buffer.from(sig).toString("base64url"), ...(kid ? { kid } : {}) }));
  await waitFor(() => drain.messages.some((m) => m.type === "auth_ok" || m.type === "auth_failed"));
  return drain.messages.find((m) => m.type === "auth_ok" || m.type === "auth_failed")!;
}

const wires = (drain: ReturnType<typeof openDrain>) => drain.messages.filter((m) => m.type === "wire");

describe("POST /relay/send sender authentication v2 (mode: required)", () => {
  it("accepts a validly signed v2 send and queues it for the recipient", async () => {
    const { port, queueStore, aud } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const headers = signSend(alice, wire, { aud });
    expect(headers[SEND_AUTH_HEADERS.aud]).toBe(aud);
    const res = await post(port, wire, headers);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ routed: "accepted" });
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("rejects an unsigned send (401) and queues nothing", async () => {
    const { port, queueStore } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const res = await post(port, wireFor(alice, bob));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/missing_auth/);
    expect(queueStore.count(bob.did)).toBe(0);
  });

  it("rejects a send forged under the victim's DID with the attacker's key (401) and queues nothing", async () => {
    const { port, queueStore, aud } = await boot();
    const victim = createIdentity("http://127.0.0.1:1");
    const attacker = createIdentity("http://127.0.0.1:3");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(attacker, bob);
    const res = await post(port, wire, signSend({ did: victim.did, signing: attacker.signing }, wire, { aud }));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/bad_signature/);
    expect(queueStore.count(bob.did)).toBe(0);
  });

  it("rejects a captured request replayed verbatim: exactly one copy is ever queued", async () => {
    const { port, queueStore, aud } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const headers = signSend(alice, wire, { aud });
    expect((await post(port, wire, headers)).status).toBe(202);
    const replay = await post(port, wire, headers);
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toMatch(/replayed/);
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("F1: a capture replayed to a SECOND relay (another origin) is 401 bad_audience and nothing is queued there", async () => {
    const first = await boot();
    const second = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const headers = signSend(alice, wire, { aud: first.aud });
    expect((await post(first.port, wire, headers)).status).toBe(202);
    const replay = await post(second.port, wire, headers);
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toMatch(/bad_audience/);
    expect(second.queueStore.count(bob.did)).toBe(0);
  });

  it("F7: a v1 signature is 401 legacy_signature in required mode", async () => {
    const { port, queueStore } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSendV1(alice, wire));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/legacy_signature/);
    expect(queueStore.count(bob.did)).toBe(0);
  });

  it("rejects a stale capture (timestamp outside the window) and answers with a Date header clients resync from", async () => {
    const { port, aud } = await boot({ senderAuthWindowMs: 60_000 });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire, { aud, now: Date.now() - 120_000 }));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/stale/);
    expect(res.date).not.toBeNull();
    expect(Math.abs(Date.parse(res.date!) - Date.now())).toBeLessThan(5_000);
  });

  it("configured senderAuthAudiences: a matching aud is accepted behind a different Host; the Host's own origin is then refused", async () => {
    const { port, queueStore, aud } = await boot({ senderAuthAudiences: ["https://relay.example"] });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob, "a1");
    expect((await post(port, wire, signSend(alice, wire, { aud: "https://relay.example" }))).status).toBe(202);
    const wire2 = wireFor(alice, bob, "a2");
    const res = await post(port, wire2, signSend(alice, wire2, { aud }));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/bad_audience/);
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("F2: the nonce store survives a restart — relay B on the same SQLite path refuses relay A's accepted capture", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "relay-nonces-")), "queue.db");
    const AUD = "https://relay.example";
    const storeA = new SqliteSendNonceStore(dbPath);
    const a = await boot({ senderAuthAudiences: [AUD], senderNonceStore: storeA });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const headers = signSend(alice, wire, { aud: AUD });
    expect((await post(a.port, wire, headers)).status).toBe(202);
    await a.relay.close();
    servers.splice(servers.indexOf(a.relay), 1);
    storeA.close();

    const storeB = new SqliteSendNonceStore(dbPath);
    sqlite.push(storeB);
    const b = await boot({ senderAuthAudiences: [AUD], senderNonceStore: storeB });
    const replay = await post(b.port, wire, headers);
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toMatch(/replayed/);
    expect(b.queueStore.count(bob.did)).toBe(0);
  });

  it("authenticates before routing: an unsigned send to an unroutable DID gets 401, not a routing verdict", async () => {
    const { port } = await boot({ isRoutable: () => false });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    expect((await post(port, wireFor(alice, bob))).status).toBe(401);
  });

  it("a signed send to an unroutable DID still gets the existing 404 rejected verdict", async () => {
    const { port, aud } = await boot({ isRoutable: () => false });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire, { aud }));
    expect(res.status).toBe(404);
    expect(res.body.routed).toBe("rejected");
  });

  it("allow-list hook: a validly signed send from a non-allowed DID gets 403", async () => {
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const { port, queueStore, aud } = await boot({ isAllowedSender: (did) => did !== alice.did });
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire, { aud }));
    expect(res.status).toBe(403);
    expect(queueStore.count(bob.did)).toBe(0);
  });
});

describe("senderAuth modes", () => {
  it('"optional": unsigned passes (staged rollout), v1 passes, but a present-and-invalid signature is still rejected', async () => {
    const { port, queueStore, aud } = await boot({ senderAuth: "optional" });
    const alice = createIdentity("http://127.0.0.1:1");
    const attacker = createIdentity("http://127.0.0.1:3");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob, "u1");
    expect((await post(port, wire)).status).toBe(202);
    const wire2 = wireFor(alice, bob, "u2");
    const bad = signSend({ did: alice.did, signing: attacker.signing }, wire2, { aud });
    expect((await post(port, wire2, bad)).status).toBe(401);
    const good = signSend(alice, wire2, { aud });
    expect((await post(port, wire2, good)).status).toBe(202);
    const wire3 = wireFor(alice, bob, "u3");
    expect((await post(port, wire3, signSendV1(alice, wire3))).status).toBe(202);
    expect(queueStore.count(bob.did)).toBe(3);
    expect(Object.keys(good).sort()).toEqual(
      [SEND_AUTH_HEADERS.did, SEND_AUTH_HEADERS.aud, SEND_AUTH_HEADERS.ts, SEND_AUTH_HEADERS.nonce, SEND_AUTH_HEADERS.sig].sort()
    );
  });

  it('"optional" with senderAuthAllowV1: false refuses v1', async () => {
    const { port } = await boot({ senderAuth: "optional", senderAuthAllowV1: false });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSendV1(alice, wire));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/legacy_signature/);
  });

  it('"off": legacy behaviour, unsigned accepted', async () => {
    const { port } = await boot({ senderAuth: "off" });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    expect((await post(port, wireFor(alice, bob))).status).toBe(202);
  });
});

describe("POST /relay/keys + send auth (key registry)", () => {
  it("without a registry the route answers 503 no_registry", async () => {
    const { port } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    expect(await postKey(port, signRevocation(alice))).toEqual({ status: 503, body: { ok: false, code: "no_registry" } });
  });

  it("malformed → 400, forged → 401 bad_signature, oversize → 413, identical twice → applied:false", async () => {
    const { port } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:1");
    const attacker = createIdentity("http://127.0.0.1:3");
    expect(await postKey(port, "{nope")).toEqual({ status: 400, body: { ok: false, code: "malformed" } });
    const rev = signRevocation(alice);
    const forged = { ...rev, sig: Buffer.from(ed25519.sign(keyRecordSigningInput(rev), attacker.signing.secretKey)).toString("base64url") };
    expect(await postKey(port, forged)).toEqual({ status: 401, body: { ok: false, code: "bad_signature" } });
    expect((await postKey(port, "x".repeat(17 * 1024))).status).toBe(413);
    expect(await postKey(port, rev)).toEqual({ status: 200, body: { ok: true, applied: true } });
    expect(await postKey(port, rev)).toEqual({ status: 200, body: { ok: true, applied: false } });
  });

  it("rotate: the old DID's send is 401 rotated, the successor's send is 202", async () => {
    const { port, aud, queueStore } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:1");
    const alice2 = createIdentity("http://127.0.0.1:4");
    const bob = createIdentity("http://127.0.0.1:2");
    expect(await postKey(port, signRotation(alice, alice2))).toEqual({ status: 200, body: { ok: true, applied: true } });
    const w1 = wireFor(alice, bob, "r1");
    const old = await post(port, w1, signSend(alice, w1, { aud }));
    expect(old.status).toBe(401);
    expect(old.body.reason).toMatch(/rotated/);
    const w2 = wireFor(alice2, bob, "r2");
    expect((await post(port, w2, signSend(alice2, w2, { aud }))).status).toBe(202);
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("revoke: the DID's send is 401 revoked", async () => {
    const { port, aud } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    expect((await postKey(port, signRevocation(alice))).status).toBe(200);
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire, { aud }));
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/revoked/);
  });

  it("device grant: a device-signed send with kid is 202; after device_revoke it is 401 revoked", async () => {
    const { port, aud } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const dev = deviceKey();
    const grant = signDeviceGrant(alice, dev);
    const w0 = wireFor(alice, bob, "d0");
    const before = await post(port, w0, signSend(alice, w0, { aud, kid: grant.kid, deviceSecretKey: dev.secretKey }));
    expect(before.status).toBe(401);
    expect(before.body.reason).toMatch(/unknown_key/);
    expect((await postKey(port, grant)).status).toBe(200);
    const w1 = wireFor(alice, bob, "d1");
    const headers = signSend(alice, w1, { aud, kid: grant.kid, deviceSecretKey: dev.secretKey });
    expect(headers[SEND_AUTH_HEADERS.kid]).toBe(grant.kid);
    expect((await post(port, w1, headers)).status).toBe(202);
    expect((await postKey(port, signDeviceRevocation(alice, grant.kid))).status).toBe(200);
    const w2 = wireFor(alice, bob, "d2");
    const after = await post(port, w2, signSend(alice, w2, { aud, kid: grant.kid, deviceSecretKey: dev.secretKey }));
    expect(after.status).toBe(401);
    expect(after.body.reason).toMatch(/revoked/);
  });
});

describe("drain auth with a key registry", () => {
  it("after rotation the old DID's drain auth is refused (auth_failed); the successor drains mail queued for the old DID and acks it", async () => {
    const { port, aud, queueStore } = await boot({ keyRegistry: new DidKeyRegistry() });
    const sender = createIdentity("http://127.0.0.1:1");
    const alice = createIdentity("http://127.0.0.1:2");
    const alice2 = createIdentity("http://127.0.0.1:4");
    const wire = wireFor(sender, alice, "held-1");
    expect((await post(port, wire, signSend(sender, wire, { aud }))).status).toBe(202);
    expect((await postKey(port, signRotation(alice, alice2))).status).toBe(200);

    const old = openDrain(port);
    const refused = await authenticate(old, alice.did, alice.signing.secretKey);
    expect(refused.type).toBe("auth_failed");
    expect(refused.reason).toMatch(/rotated/);
    expect(wires(old)).toEqual([]);

    const next = openDrain(port);
    expect((await authenticate(next, alice2.did, alice2.signing.secretKey)).type).toBe("auth_ok");
    await waitFor(() => wires(next).length === 1);
    expect(wires(next)[0]!.wire).toBe(wire);
    next.ws.send(JSON.stringify({ type: "ack", ids: [wires(next)[0]!.id] }));
    await waitFor(() => queueStore.count(alice.did) === 0);
  });

  it("a send to the old DID while the successor drains is flushed live to the successor's socket", async () => {
    const { port, aud } = await boot({ keyRegistry: new DidKeyRegistry() });
    const sender = createIdentity("http://127.0.0.1:1");
    const alice = createIdentity("http://127.0.0.1:2");
    const alice2 = createIdentity("http://127.0.0.1:4");
    expect((await postKey(port, signRotation(alice, alice2))).status).toBe(200);
    const next = openDrain(port);
    expect((await authenticate(next, alice2.did, alice2.signing.secretKey)).type).toBe("auth_ok");
    const wire = wireFor(sender, alice, "live-old");
    expect((await post(port, wire, signSend(sender, wire, { aud }))).status).toBe(202);
    await waitFor(() => wires(next).length === 1);
    expect(wires(next)[0]!.wire).toBe(wire);
  });

  it("a rotation landing while both drains are open closes the old DID's drain and hands its queue to the successor", async () => {
    const { port, aud } = await boot({ keyRegistry: new DidKeyRegistry() });
    const sender = createIdentity("http://127.0.0.1:1");
    const alice = createIdentity("http://127.0.0.1:2");
    const alice2 = createIdentity("http://127.0.0.1:4");
    const old = openDrain(port);
    expect((await authenticate(old, alice.did, alice.signing.secretKey)).type).toBe("auth_ok");
    const next = openDrain(port);
    expect((await authenticate(next, alice2.did, alice2.signing.secretKey)).type).toBe("auth_ok");
    expect((await postKey(port, signRotation(alice, alice2))).status).toBe(200);
    await waitFor(() => old.isClosed());
    const wire = wireFor(sender, alice, "after-rotate");
    expect((await post(port, wire, signSend(sender, wire, { aud }))).status).toBe(202);
    await waitFor(() => wires(next).length === 1);
    expect(wires(old)).toEqual([]);
  });

  it("a revoked DID's drain auth is refused", async () => {
    const { port } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:2");
    expect((await postKey(port, signRevocation(alice))).status).toBe(200);
    const drain = openDrain(port);
    const res = await authenticate(drain, alice.did, alice.signing.secretKey);
    expect(res.type).toBe("auth_failed");
    expect(res.reason).toMatch(/revoked/);
  });

  it("a granted device key drains with `kid`; device_revoke closes that drain and refuses the next one", async () => {
    const { port, aud } = await boot({ keyRegistry: new DidKeyRegistry() });
    const sender = createIdentity("http://127.0.0.1:1");
    const alice = createIdentity("http://127.0.0.1:2");
    const dev = deviceKey();
    const grant = signDeviceGrant(alice, dev);
    expect((await postKey(port, grant)).status).toBe(200);
    const wire = wireFor(sender, alice, "to-device");
    expect((await post(port, wire, signSend(sender, wire, { aud }))).status).toBe(202);
    const drain = openDrain(port);
    expect((await authenticate(drain, alice.did, dev.secretKey, grant.kid)).type).toBe("auth_ok");
    await waitFor(() => wires(drain).length === 1);
    expect((await postKey(port, signDeviceRevocation(alice, grant.kid))).status).toBe(200);
    await waitFor(() => drain.isClosed());
    const again = openDrain(port);
    const res = await authenticate(again, alice.did, dev.secretKey, grant.kid);
    expect(res.type).toBe("auth_failed");
    expect(res.reason).toMatch(/revoked/);
  });

  it("a device key signing WITHOUT its kid does not pass as the root key", async () => {
    const { port } = await boot({ keyRegistry: new DidKeyRegistry() });
    const alice = createIdentity("http://127.0.0.1:2");
    const dev = deviceKey();
    expect((await postKey(port, signDeviceGrant(alice, dev))).status).toBe(200);
    const drain = openDrain(port);
    expect((await authenticate(drain, alice.did, dev.secretKey)).type).toBe("auth_failed");
  });

  it("without a registry, a drain auth naming a kid is refused (nothing could vouch for it)", async () => {
    const { port } = await boot();
    const alice = createIdentity("http://127.0.0.1:2");
    const dev = deviceKey();
    const grant = signDeviceGrant(alice, dev);
    const drain = openDrain(port);
    const res = await authenticate(drain, alice.did, dev.secretKey, grant.kid);
    expect(res.type).toBe("auth_failed");
  });
});
