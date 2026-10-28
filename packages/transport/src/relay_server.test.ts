// relay_server.test.ts — Task 6's required test list, plus supporting
// coverage for the drain-auth security boundary and 6c liveness. Runs a
// real RelayServer over real localhost HTTP + WS (RelayServer.listen()),
// exercised with real did:peer:2 identities and real packMessage() wires —
// mirrors didcomm_transport.integration.test.ts's "real listeners,
// poll-don't-assert-immediately" discipline.
import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseEnvelope } from "@resource-web/protocol";
import { createIdentity, type Identity } from "./did_identity.js";
import { packMessage, unpackMessage } from "./didcomm_crypto.js";
import { ENVELOPE_TYPE } from "./didcomm_transport.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import { RelayServer, type RelayServerOptions } from "./relay_server.js";
import { InMemoryRelayQueueStore, MAX_HOLD_HORIZON_MS, SqliteRelayQueueStore, type RelayQueueStore } from "./relay_queue_store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function bootRelay(opts?: RelayServerOptions): Promise<{ relay: RelayServer; port: number }> {
  // These tests exercise queueing/drain/caps over raw unsigned POSTs; sender auth has its own suite
  // (relay_send_auth.integration.test.ts), so it is switched off here unless a test opts back in.
  const relay = new RelayServer({ senderAuth: "off", ...opts });
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, port };
}

async function submitOverHttp(port: number, wire: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: wire });
  const body = await res.json();
  return { status: res.status, body };
}

interface DrainMessage {
  type: string;
  [k: string]: unknown;
}

/** Opens a drain WS, waits for the challenge, and returns a handle for driving the rest of the auth/drain flow. */
function openDrain(port: number, opts?: { autoPong?: boolean }): { ws: WebSocket; messages: DrainMessage[]; challenge: Promise<string> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/drain`, opts);
  sockets.push(ws);
  const messages: DrainMessage[] = [];
  let resolveChallenge!: (nonce: string) => void;
  const challenge = new Promise<string>((resolve) => {
    resolveChallenge = resolve;
  });
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as DrainMessage;
    messages.push(msg);
    if (msg.type === "challenge") resolveChallenge(msg.nonce as string);
  });
  return { ws, messages, challenge };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Authenticate as `identity` on an already-open drain socket using its REAL signing key. */
async function authenticate(drain: ReturnType<typeof openDrain>, identity: Identity): Promise<void> {
  const nonce = await drain.challenge;
  const sig = ed25519.sign(unb64u(nonce), identity.signing.secretKey);
  drain.ws.send(JSON.stringify({ type: "auth", did: identity.did, sig: b64u(sig) }));
}

function buildWire(sender: Identity, recipient: Identity, id: string, createdTime = Date.now()): string {
  return packMessage({
    sender,
    recipientDid: recipient.did,
    message: {
      id,
      type: ENVELOPE_TYPE,
      from: sender.did,
      to: [recipient.did],
      created_time: createdTime,
      body: ENVELOPE_FIXTURES[0],
    },
  });
}

describe("RelayServer — Task 6a: accept + persist + route", () => {
  it("a message for an offline DID is queued, then delivered verbatim once that DID authenticates and drains", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "offline-msg-1");
    const submitRes = await submitOverHttp(port, wire);
    expect(submitRes.status).toBe(202);
    // Non-informative success (finding 1): the response never reveals live vs
    // queued, nor a queue id / recipient DID — just "accepted".
    expect(submitRes.body).toEqual({ routed: "accepted" });

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);

    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    const wireMsg = drain.messages.find((m) => m.type === "wire")!;
    expect(wireMsg.wire).toBe(wire); // byte-identical to what was submitted

    // The recipient can decrypt it exactly as if it had arrived directly.
    const unpacked = unpackMessage({ recipient: ben, wire: wireMsg.wire as string });
    expect(unpacked.from).toBe(anna.did);
    expect(unpacked.message.id).toBe("offline-msg-1");
  });

  it("queued wire is byte-identical to the sent wire and does not parse as a protocol Envelope (the relay cannot read plaintext)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { relay, port } = await bootRelay();
    void relay;

    const wire = buildWire(anna, ben, "opaque-check");
    await submitOverHttp(port, wire);

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));

    const stored = drain.messages.find((m) => m.type === "wire")!.wire as string;
    expect(stored).toBe(wire);
    // The outer wire is ciphertext-shaped ({typ,alg,epk,nonce,ciphertext,to}),
    // never a protocol Envelope — parsing it as one must fail.
    expect(() => parseEnvelope(stored)).toThrow();
  });

  it("a message for a DID this relay does not route reports failure synchronously (so a caller can fall back to the next ladder rung)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm"); // routable
    const stranger = createIdentity("http://stranger.example/didcomm"); // NOT routable

    const { relay, port } = await bootRelay({ isRoutable: (did) => did === ben.did });

    const routedResult = relay.submit(buildWire(anna, ben, "routable-1"));
    expect(routedResult.routed).not.toBe("rejected");

    const wire = buildWire(anna, stranger, "unroutable-1");
    const directResult = relay.submit(wire);
    expect(directResult).toEqual({ routed: "rejected", reason: expect.stringContaining("no route") });

    const httpResult = await submitOverHttp(port, wire);
    expect(httpResult.status).toBe(404);
    expect((httpResult.body as { reason: string }).reason).toMatch(/no route/);
  });

  it("a malformed wire (not JSON, or missing outer 'to') is rejected without touching the queue", async () => {
    const { relay } = await bootRelay();
    expect(relay.submit("not json at all").routed).toBe("rejected");
    expect(relay.submit(JSON.stringify({ ciphertext: "x" })).routed).toBe("rejected"); // no `to`
  });

  it("submitting while the recipient is already connected and authenticated delivers live (routed: 'live')", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "auth_ok"));

    const wire = buildWire(anna, ben, "live-msg-1");
    const submitRes = await submitOverHttp(port, wire);
    // Same non-informative "accepted" as the offline/queued case above — the
    // submitter cannot tell that Ben was live (presence-oracle closed).
    expect(submitRes.body).toEqual({ routed: "accepted" });

    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    expect(drain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });
});

describe("RelayServer — finding 1: ingress oracle closed + validate-before-enqueue", () => {
  it("the submit response is byte-identical ('accepted', no queueId/toDid) whether the recipient is live or offline", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const carol = createIdentity("http://carol.example/didcomm");
    const { port } = await bootRelay();

    // Carol is offline → queued path.
    const queuedRes = await submitOverHttp(port, buildWire(anna, carol, "q-1"));

    // Ben authenticates → live path.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "auth_ok"));
    const liveRes = await submitOverHttp(port, buildWire(anna, ben, "l-1"));

    // Identical body, identical status — no live/queued, no queueId, no toDid.
    expect(queuedRes.body).toEqual({ routed: "accepted" });
    expect(liveRes.body).toEqual({ routed: "accepted" });
    expect(queuedRes.status).toBe(liveRes.status);
    expect(JSON.stringify(queuedRes.body)).toBe(JSON.stringify(liveRes.body));
  });

  it("a probe to a non-connected DID grows that DID's queue by exactly one, and a rejected/garbage submit does not grow it at all (validate-before-enqueue)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm"); // routable
    const stranger = createIdentity("http://stranger.example/didcomm"); // NOT routable
    const store = new InMemoryRelayQueueStore();
    const { relay } = await bootRelay({ isRoutable: (did) => did === ben.did, queueStore: store });

    // One valid probe for the offline (but routable) Ben → exactly one row.
    expect(relay.submit(buildWire(anna, ben, "probe-1")).routed).toBe("accepted");
    expect(store.count(ben.did)).toBe(1);

    // A second valid probe → exactly two (no double-enqueue per submit).
    expect(relay.submit(buildWire(anna, ben, "probe-2")).routed).toBe("accepted");
    expect(store.count(ben.did)).toBe(2);

    // Unroutable, malformed-JSON, and missing-`to` submits must NOT enqueue.
    expect(relay.submit(buildWire(anna, stranger, "probe-3")).routed).toBe("rejected");
    expect(relay.submit("not json").routed).toBe("rejected");
    expect(relay.submit(JSON.stringify({ ciphertext: "x" })).routed).toBe("rejected");
    expect(store.count(stranger.did)).toBe(0);
    expect(store.total()).toBe(2); // only the two valid probes ever landed
  });
});

describe("RelayServer — finding 2: wire-size cap inside submit() (protects every caller)", () => {
  it("submit() itself rejects an oversize wire before parse/enqueue, independent of the HTTP streaming guard", async () => {
    const ben = createIdentity("http://ben.example/didcomm");
    const store = new InMemoryRelayQueueStore();
    const { relay } = await bootRelay({ maxWireBytes: 512, queueStore: store });

    const oversize = JSON.stringify({ to: ben.did, ciphertext: "x".repeat(1024) });
    expect(Buffer.byteLength(oversize, "utf8")).toBeGreaterThan(512);
    const result = relay.submit(oversize);
    expect(result.routed).toBe("rejected");
    expect((result as { reason: string }).reason).toMatch(/exceeds/);
    expect(store.total()).toBe(0); // nothing enqueued
  });
});

describe("RelayServer — finding 3: per-DID and global queue caps", () => {
  it("rejects a submit once the per-DID cap is reached, without dropping already-queued mail", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const store = new InMemoryRelayQueueStore();
    const { relay } = await bootRelay({ maxQueuePerDid: 3, queueStore: store });

    for (let i = 0; i < 3; i++) expect(relay.submit(buildWire(anna, ben, `cap-${i}`)).routed).toBe("accepted");
    expect(store.count(ben.did)).toBe(3);

    // The 4th is refused — and the existing three are untouched.
    const over = relay.submit(buildWire(anna, ben, "cap-over"));
    expect(over.routed).toBe("rejected");
    expect((over as { reason: string }).reason).toMatch(/queue is full/);
    expect(store.count(ben.did)).toBe(3);
  });

  it("rejects a submit once the global cap is reached, even spread across distinct recipient DIDs", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const carol = createIdentity("http://carol.example/didcomm");
    const store = new InMemoryRelayQueueStore();
    const { relay } = await bootRelay({ maxQueueGlobal: 2, queueStore: store });

    expect(relay.submit(buildWire(anna, ben, "g-1")).routed).toBe("accepted");
    expect(relay.submit(buildWire(anna, carol, "g-2")).routed).toBe("accepted");
    expect(store.total()).toBe(2);

    // A third for a brand-new DID (well under its own per-DID cap) still fails.
    const over = relay.submit(buildWire(anna, createIdentity("http://dave.example/didcomm"), "g-3"));
    expect(over.routed).toBe("rejected");
    expect(store.total()).toBe(2);
  });

  it("TrustWeb review 6h: a full relay first lets go of wires older than the shared horizon (a long RELAY_QUEUE_HOLD_MS never shuts it for good); recent mail is never dropped", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const carol = createIdentity("http://carol.example/didcomm");
    // A store with a very long hold (RELAY_QUEUE_HOLD_MS = years): its own prune keeps everything; only an explicit horizon drops rows.
    const inner = new InMemoryRelayQueueStore();
    const store: RelayQueueStore = {
      enqueue: (to, wire) => inner.enqueue(to, wire),
      drain: (to) => inner.drain(to),
      ackDelivered: (to, ids) => inner.ackDelivered(to, ids),
      prune: (now, holdMs) => { if (holdMs !== undefined) inner.prune(now, holdMs); },
      count: (to) => inner.count(to),
      total: () => inner.total(),
    };
    const { relay } = await bootRelay({ maxQueueGlobal: 2, queueStore: store });
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(t0);
      // A wire for a recipient that never came back, queued long ago (kept by a long hold, prune() alone would keep it).
      store.enqueue(ben.did, buildWire(anna, ben, "old-1"));
      vi.setSystemTime(t0 + MAX_HOLD_HORIZON_MS + 60_000);
      expect(relay.submit(buildWire(anna, carol, "new-1")).routed).toBe("accepted");
      expect(store.total()).toBe(2);
      // Full: the old one goes, the new one is taken.
      expect(relay.submit(buildWire(anna, carol, "new-2")).routed).toBe("accepted");
      expect(store.count(ben.did)).toBe(0);
      expect(store.count(carol.did)).toBe(2);
      // Full of recent mail only: rejected as before, nothing dropped.
      expect(relay.submit(buildWire(anna, ben, "new-3")).routed).toBe("rejected");
      expect(store.count(carol.did)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RelayServer — Task 6b: authenticated drain (spoof rejection)", () => {
  it("a drain whose signature does not match the claimed DID is rejected: no auth_ok, no wire leak, socket closes", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm"); // the real owner of the target queue
    const mallory = createIdentity("http://mallory.example/didcomm"); // attacker, signs with their OWN key
    const { port } = await bootRelay();

    // A message is waiting for Ben.
    const wire = buildWire(anna, ben, "targeted-msg");
    await submitOverHttp(port, wire);

    // Mallory connects, claims to be Ben, but signs the nonce with Mallory's key.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    const nonce = await drain.challenge;
    const forgedSig = ed25519.sign(unb64u(nonce), mallory.signing.secretKey);
    drain.ws.send(JSON.stringify({ type: "auth", did: ben.did, sig: b64u(forgedSig) }));

    await waitFor(() => drain.messages.some((m) => m.type === "auth_failed"));
    // Give any (incorrect) flush a moment to happen if the implementation were buggy.
    await new Promise((r) => setTimeout(r, 100));
    expect(drain.messages.some((m) => m.type === "auth_ok")).toBe(false);
    expect(drain.messages.some((m) => m.type === "wire")).toBe(false); // no queue leak
    await waitFor(() => drain.ws.readyState === WebSocket.CLOSED);

    // Ben's message must still be intact — nothing was lost or leaked to the impostor.
    const realDrain = openDrain(port);
    await waitForOpen(realDrain.ws);
    await authenticate(realDrain, ben);
    await waitFor(() => realDrain.messages.some((m) => m.type === "wire"));
    expect(realDrain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });

  it("a drain with a syntactically well-formed but cryptographically wrong signature (right DID, garbage sig bytes) is rejected", async () => {
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await drain.challenge;
    drain.ws.send(JSON.stringify({ type: "auth", did: ben.did, sig: b64u(new Uint8Array(64)) }));
    await waitFor(() => drain.messages.some((m) => m.type === "auth_failed"));
  });

  it("two-hop: Anna sends to Ben via the relay (their common friend); the relay never decrypts and Ben receives Anna's authenticated message after draining", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay({ isRoutable: (did) => did === ben.did });

    // Anna and Ben are not directly connected to one another at all — only
    // to the relay. This is exactly the two-hop shape: Anna -> relay -> Ben.
    const wire = buildWire(anna, ben, "two-hop-msg");
    const submitRes = await submitOverHttp(port, wire);
    expect(submitRes.status).toBe(202);

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));

    const received = drain.messages.find((m) => m.type === "wire")!.wire as string;
    const unpacked = unpackMessage({ recipient: ben, wire: received });
    expect(unpacked.from).toBe(anna.did); // sender authenticity survives the hop
    expect(unpacked.message.id).toBe("two-hop-msg");
  });
});

describe("RelayServer — DoS hardening: auth deadline + max wire size", () => {
  it("a drain socket that never completes auth within the deadline is closed by the server", async () => {
    const { port } = await bootRelay({ authDeadlineMs: 40 });

    // Open the socket and receive the challenge, but never send `auth`.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await drain.challenge;
    expect(drain.ws.readyState).toBe(WebSocket.OPEN);

    // The auth-deadline timer (not the heartbeat) must reap this idle,
    // never-authenticated socket.
    await waitFor(() => drain.ws.readyState === WebSocket.CLOSED, 2000);
    expect(drain.messages.some((m) => m.type === "auth_ok")).toBe(false);
  });

  it("a body exceeding MAX_WIRE_BYTES is rejected (413) and nothing is enqueued", async () => {
    const ben = createIdentity("http://ben.example/didcomm");
    const { relay, port } = await bootRelay({ maxWireBytes: 1024 });

    const oversized = JSON.stringify({ to: ben.did, ciphertext: "x".repeat(2000) });
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(1024);

    const res = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: oversized });
    expect(res.status).toBe(413);

    // Nothing was enqueued: an authenticated drain for `ben` sees no wire.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "auth_ok"));
    await new Promise((r) => setTimeout(r, 150));
    expect(drain.messages.some((m) => m.type === "wire")).toBe(false);

    void relay;
  });
});

describe("RelayServer — Task 6c: forward-on-connect, ack, and liveness", () => {
  it("acking a delivered wire removes it from the queue; a second drain (reconnect) does not redeliver it", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "ack-once");
    await submitOverHttp(port, wire);

    const drain1 = openDrain(port);
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "wire"));
    const id = drain1.messages.find((m) => m.type === "wire")!.id as string;
    drain1.ws.send(JSON.stringify({ type: "ack", ids: [id] }));
    await new Promise((r) => setTimeout(r, 100)); // let the ack land server-side
    drain1.ws.close();

    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "auth_ok"));
    await new Promise((r) => setTimeout(r, 150)); // no further "wire" should ever arrive
    expect(drain2.messages.some((m) => m.type === "wire")).toBe(false);
  });

  it("an unacked wire is redelivered after the drain disconnects and reconnects (re-enqueue on disconnect)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "unacked-msg");
    await submitOverHttp(port, wire);

    const drain1 = openDrain(port);
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "wire"));
    drain1.ws.terminate(); // dies before acking — no clean close

    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "wire"));
    expect(drain2.messages.find((m) => m.type === "wire")!.wire).toBe(wire); // redelivered, still verbatim
  });

  it("heartbeat reclaims a drain slot for an unresponsive (non-pong-answering) socket, allowing a fresh connection to authenticate and drain", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay({ heartbeatIntervalMs: 40 });

    // Simulate a hung connection: stop answering pings at the protocol level
    // (autoPong: false) instead of a clean close, so only the heartbeat can
    // detect and reclaim it.
    const drain1 = openDrain(port, { autoPong: false });
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "auth_ok"));

    // Two missed heartbeat ticks should be enough for the server to terminate it.
    await waitFor(() => drain1.ws.readyState === WebSocket.CLOSED, 2000);

    // A message arriving after the dead drain is reclaimed queues normally...
    const wire = buildWire(anna, ben, "post-heartbeat-msg");
    await submitOverHttp(port, wire);

    // ...and a fresh, responsive connection can authenticate and drain it.
    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "wire"));
    expect(drain2.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });
});

describe("RelayServer — finding 4: durable store-and-forward across a relay restart", () => {
  it("a wire queued for an offline DID survives a relay restart (new RelayServer on the same Sqlite store path) and drains afterward", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const dbPath = join(mkdtempSync(join(tmpdir(), "relay-durable-")), "relay_queue.db");

    // Boot #1: Ben is offline; Anna submits — the wire is persisted to SQLite.
    const store1 = new SqliteRelayQueueStore(dbPath);
    const relay1 = new RelayServer({ queueStore: store1, senderAuth: "off" });
    const { port: port1 } = await relay1.listen(0, "127.0.0.1");
    const wire = buildWire(anna, ben, "durable-1");
    expect((await submitOverHttp(port1, wire)).body).toEqual({ routed: "accepted" });

    // Simulate a full relay restart: tear down the server AND its store handle.
    await relay1.close();
    store1.close();

    // Boot #2: a brand-new RelayServer on the SAME db path — held mail intact.
    const store2 = new SqliteRelayQueueStore(dbPath);
    const relay2 = new RelayServer({ queueStore: store2, senderAuth: "off" });
    const { port: port2 } = await relay2.listen(0, "127.0.0.1");

    const drain = openDrain(port2);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    expect(drain.messages.find((m) => m.type === "wire")!.wire).toBe(wire); // survived restart, verbatim

    await relay2.close();
    store2.close();
  });
});
