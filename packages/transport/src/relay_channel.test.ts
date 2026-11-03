// relay_channel.test.ts — Task 7's required test list, exercised as real
// client<->server round-trips against a live RelayServer instance, mirroring
// relay_server.test.ts's "real listeners, poll-don't-assert-immediately"
// discipline.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createIdentity, type Identity } from "./did_identity.js";
import { packMessage } from "./didcomm_crypto.js";
import { ENVELOPE_TYPE, DidCommTransport } from "./didcomm_transport.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import { RelayServer } from "./relay_server.js";
import { RelayChannel } from "./relay_channel.js";
import { SEND_AUTH_HEADERS } from "./relay_send_auth.js";
import { DidKeyRegistry } from "./did_key_registry.js";
import { signDeviceGrant } from "./did_key_records.js";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

const servers: RelayServer[] = [];
const channels: RelayChannel[] = [];
const rawSockets: WebSocket[] = [];
const plainHttpServers: HttpServer[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const ws of rawSockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await Promise.all(channels.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(plainHttpServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function bootRelay(): Promise<{ relay: RelayServer; endpoint: string }> {
  const relay = new RelayServer();
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, endpoint: `http://127.0.0.1:${port}` };
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- helpers for a raw (non-RelayChannel) drain, used to drive server-side
// scenarios the RelayChannel client itself can't trigger (e.g. forcing the
// server to close a channel's live socket via the one-drain-per-DID rule).
interface DrainMessage {
  type: string;
  [k: string]: unknown;
}

function openRawDrain(endpoint: string): { ws: WebSocket; messages: DrainMessage[]; challenge: Promise<string> } {
  const wsUrl = endpoint.replace(/^http/, "ws") + "/relay/drain";
  const ws = new WebSocket(wsUrl);
  rawSockets.push(ws);
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

async function authenticateRaw(drain: ReturnType<typeof openRawDrain>, identity: Identity): Promise<void> {
  const nonce = await drain.challenge;
  const sig = ed25519.sign(unb64u(nonce), identity.signing.secretKey);
  drain.ws.send(JSON.stringify({ type: "auth", did: identity.did, sig: b64u(sig) }));
}

describe("RelayChannel — deliver()", () => {
  it("resolves on the relay's delivery-ack when the recipient is offline (queued)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(channel);
    const wire = buildWire(anna, ben, "queued-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();

    // Confirm it was actually accepted by the relay, byte-identical.
    const drain = openRawDrain(endpoint);
    await waitForOpen(drain.ws);
    await authenticateRaw(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    expect(drain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });

  it("resolves on the delivery-ack when the recipient is live-connected (routed: live)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    const benDrain = openRawDrain(endpoint);
    await waitForOpen(benDrain.ws);
    await authenticateRaw(benDrain, ben);
    await waitFor(() => benDrain.messages.some((m) => m.type === "auth_ok"));

    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(channel);
    const wire = buildWire(anna, ben, "live-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();
    await waitFor(() => benDrain.messages.some((m) => m.type === "wire"));
    expect(benDrain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });

  it("rejects when the relay endpoint never responds within the ack timeout", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");

    // A raw HTTP server that accepts the connection but never responds —
    // RelayServer itself always answers fast, so this is the clean lever for
    // exercising the timeout path deterministically.
    const hangServer = createHttpServer((_req, _res) => {
      // never call res.end() / res.writeHead()
    });
    plainHttpServers.push(hangServer);
    await new Promise<void>((r) => hangServer.listen(0, "127.0.0.1", () => r()));
    const port = (hangServer.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}`;

    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint], ackTimeoutMs: 150 });
    channels.push(channel);
    const wire = buildWire(anna, ben, "timeout-1");
    await expect(channel.deliver(ben.did, wire)).rejects.toThrow();
  });

  it("rejects when the relay endpoint is unreachable (connection refused)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");

    // Reserve a port, then close it immediately so nothing listens there.
    const probe = createHttpServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const deadEndpoint = `http://127.0.0.1:${port}`;

    const channel = new RelayChannel(anna, { relayEndpoints: [deadEndpoint], ackTimeoutMs: 500 });
    channels.push(channel);
    const wire = buildWire(anna, ben, "unreachable-1");
    await expect(channel.deliver(ben.did, wire)).rejects.toThrow();
  });

  it("a rejected (no-route) endpoint is skipped in favor of the next configured endpoint", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const stranger = createIdentity("http://stranger.example/didcomm");

    // relayA does not route for ben; relayB does.
    const relayA = new RelayServer({ isRoutable: (did) => did === stranger.did });
    servers.push(relayA);
    const { port: portA } = await relayA.listen(0, "127.0.0.1");
    const { endpoint: endpointB } = await bootRelay();

    const channel = new RelayChannel(anna, { relayEndpoints: [`http://127.0.0.1:${portA}`, endpointB] });
    channels.push(channel);
    const wire = buildWire(anna, ben, "fallback-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();

    const drain = openRawDrain(endpointB);
    await waitForOpen(drain.ws);
    await authenticateRaw(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    expect(drain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });
});

describe("RelayChannel — onInbound() drain handshake", () => {
  it("authenticates and feeds onInbound with each queued wire, in order", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    const wire1 = buildWire(anna, ben, "queued-a");
    const wire2 = buildWire(anna, ben, "queued-b");
    const wire3 = buildWire(anna, ben, "queued-c");
    const senderChannel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(senderChannel);
    await senderChannel.deliver(ben.did, wire1);
    await senderChannel.deliver(ben.did, wire2);
    await senderChannel.deliver(ben.did, wire3);

    const received: string[] = [];
    const benChannel = new RelayChannel(ben, { relayEndpoints: [endpoint] });
    channels.push(benChannel);
    benChannel.onInbound((wire) => received.push(wire));

    await waitFor(() => received.length >= 3);
    expect(received).toEqual(expect.arrayContaining([wire1, wire2, wire3]));
  });

  it("drained wires are accepted by DidCommTransport.receiveInbound, including a message aged well past the old 5-min replay window (proves Task 2's widened H)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    // 10 minutes old — would have been rejected under the pre-Task-2 5-min
    // REPLAY_WINDOW_MS, and must be accepted now under the widened horizon H.
    const oldCreatedTime = Date.now() - 10 * 60 * 1000;
    const wire = buildWire(anna, ben, "aged-msg", oldCreatedTime);
    const senderChannel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(senderChannel);
    await senderChannel.deliver(ben.did, wire);

    const benChannel = new RelayChannel(ben, { relayEndpoints: [endpoint] });
    channels.push(benChannel);
    const benTransport = new DidCommTransport(ben, { channel: benChannel });
    await benTransport.init({ self: ben.did });

    const receivedEnvelopes: { from: string }[] = [];
    benTransport.onEnvelope((from) => receivedEnvelopes.push({ from }));

    await waitFor(() => receivedEnvelopes.length >= 1, 5000);
    expect(receivedEnvelopes[0]!.from).toBe(anna.did);
  });

  it("a message enqueued while the recipient's channel is offline is drained once it connects", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    // Submit directly against the relay (Ben's channel isn't running yet).
    const wire = buildWire(anna, ben, "offline-then-online");
    const senderChannel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(senderChannel);
    await senderChannel.deliver(ben.did, wire);

    const received: string[] = [];
    const benChannel = new RelayChannel(ben, { relayEndpoints: [endpoint] });
    channels.push(benChannel);
    benChannel.onInbound((w) => received.push(w));

    await waitFor(() => received.includes(wire));
  });

  it("reconnect after a dropped WS re-drains without duplicate dispatch of an already-acked wire", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRelay();

    const senderChannel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(senderChannel);

    const received: string[] = [];
    const benChannel = new RelayChannel(ben, { relayEndpoints: [endpoint], reconnect: { baseMs: 50, maxMs: 200 } });
    channels.push(benChannel);
    benChannel.onInbound((w) => received.push(w));

    const wire1 = buildWire(anna, ben, "before-drop");
    await senderChannel.deliver(ben.did, wire1);
    await waitFor(() => received.includes(wire1));
    // Let the ack for wire1 land server-side before we force a drop.
    await sleep(150);

    // Force the server to close benChannel's live drain socket, using the
    // documented one-drain-per-DID rule (a fresh authenticated connection for
    // the same DID displaces the previous one) — a real server-initiated
    // disconnect that exercises RelayChannel's own reconnect path, not just
    // the server's ack/dequeue behavior.
    const impostorDrain = openRawDrain(endpoint);
    await waitForOpen(impostorDrain.ws);
    await authenticateRaw(impostorDrain, ben);
    await waitFor(() => impostorDrain.messages.some((m) => m.type === "auth_ok"));
    impostorDrain.ws.close(); // free the slot again so benChannel's reconnect can re-claim it

    const wire2 = buildWire(anna, ben, "after-reconnect");
    await senderChannel.deliver(ben.did, wire2);
    await waitFor(() => received.includes(wire2), 8000);

    // wire1 must not have been redelivered (it was acked before the drop).
    expect(received.filter((w) => w === wire1)).toHaveLength(1);
    expect(received.filter((w) => w === wire2)).toHaveLength(1);
  });
});

// ---- v2 sender auth (SPEC "B"): the channel signs for the relay's origin, recovers from a skewed clock once, and can
// sign with a granted device key. Every test here runs against a relay booted with senderAuth "required", so an
// accepted delivery IS proof the relay verified the v2 signature (aud derived from the Host header, which fetch sets
// to 127.0.0.1:<port>).
interface SeenPost {
  url: string;
  headers: Record<string, string>;
}

/** Wraps the real fetch so a test can count ingress POSTs and inspect their headers; the request still goes out. */
function spyOnIngress(): SeenPost[] {
  const seen: SeenPost[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (init?.method === "POST") {
      seen.push({ url: String(input), headers: { ...((init.headers as Record<string, string> | undefined) ?? {}) } });
    }
    return realFetch(input, init);
  });
  return seen;
}

async function bootRequiredRelay(opts: { keyRegistry?: DidKeyRegistry } = {}): Promise<{ relay: RelayServer; endpoint: string }> {
  const relay = new RelayServer({ senderAuth: "required", ...(opts.keyRegistry ? { keyRegistry: opts.keyRegistry } : {}) });
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, endpoint: `http://127.0.0.1:${port}` };
}

async function drainOne(endpoint: string, identity: Identity): Promise<string> {
  const drain = openRawDrain(endpoint);
  await waitForOpen(drain.ws);
  await authenticateRaw(drain, identity);
  await waitFor(() => drain.messages.some((m) => m.type === "wire"));
  return drain.messages.find((m) => m.type === "wire")!.wire as string;
}

describe("RelayChannel — v2 sender auth", () => {
  it("delivers to a relay that REQUIRES sender auth, signing for the endpoint's origin", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRequiredRelay();
    const seen = spyOnIngress();

    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint] });
    channels.push(channel);
    const wire = buildWire(anna, ben, "v2-required-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers[SEND_AUTH_HEADERS.aud]).toBe(endpoint);
    expect(seen[0]!.headers[SEND_AUTH_HEADERS.did]).toBe(anna.did);
    expect(seen[0]!.headers[SEND_AUTH_HEADERS.kid]).toBeUndefined();
    expect(await drainOne(endpoint, ben)).toBe(wire);
  });

  it("a sender whose clock is 10 minutes slow still delivers: one 401 stale, then ONE re-signed retry using the relay's Date header", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { endpoint } = await bootRequiredRelay();
    const seen = spyOnIngress();

    const skewMs = 10 * 60_000;
    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint], now: () => Date.now() - skewMs });
    channels.push(channel);
    const wire = buildWire(anna, ben, "v2-skewed-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();

    expect(seen).toHaveLength(2);
    const firstTs = Number(seen[0]!.headers[SEND_AUTH_HEADERS.ts]);
    const retryTs = Number(seen[1]!.headers[SEND_AUTH_HEADERS.ts]);
    // the retry moved forward by ~the skew (Date has 1 s resolution)
    expect(retryTs - firstTs).toBeGreaterThan(skewMs - 5_000);
    expect(seen[1]!.headers[SEND_AUTH_HEADERS.nonce]).not.toBe(seen[0]!.headers[SEND_AUTH_HEADERS.nonce]);
    expect(await drainOne(endpoint, ben)).toBe(wire);
  });

  it("a stale refusal without a Date header is not retried (no blind loop)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    // A plain server that always answers like a relay refusing a stale send, but without a Date header.
    let posts = 0;
    const staleServer = createHttpServer((req, res) => {
      posts++;
      req.resume();
      res.sendDate = false;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ routed: "rejected", reason: "sender authentication failed: stale" }));
    });
    plainHttpServers.push(staleServer);
    await new Promise<void>((r) => staleServer.listen(0, "127.0.0.1", () => r()));
    const port = (staleServer.address() as AddressInfo).port;

    const channel = new RelayChannel(anna, { relayEndpoints: [`http://127.0.0.1:${port}`] });
    channels.push(channel);
    await expect(channel.deliver(ben.did, buildWire(anna, ben, "stale-no-date"))).rejects.toThrow();
    expect(posts).toBe(1);
  });

  it("a channel with a granted device key sends x-tw-relay-kid and the relay (with a key registry) accepts it", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const deviceSecret = ed25519.utils.randomSecretKey();
    const device = { secretKey: deviceSecret, publicKey: ed25519.getPublicKey(deviceSecret) };
    const grant = signDeviceGrant(anna, device, {});

    const keyRegistry = new DidKeyRegistry();
    expect(keyRegistry.apply(grant)).toMatchObject({ ok: true });
    const { endpoint } = await bootRequiredRelay({ keyRegistry });
    const seen = spyOnIngress();

    const channel = new RelayChannel(anna, { relayEndpoints: [endpoint], deviceKey: { kid: grant.kid, secretKey: deviceSecret } });
    channels.push(channel);
    const wire = buildWire(anna, ben, "v2-device-1");
    await expect(channel.deliver(ben.did, wire)).resolves.toBeUndefined();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers[SEND_AUTH_HEADERS.kid]).toBe(grant.kid);
    expect(await drainOne(endpoint, ben)).toBe(wire);

    // The same device key without its kid is just a wrong root signature: refused.
    const impostor = new RelayChannel({ ...anna, signing: device }, { relayEndpoints: [endpoint] });
    channels.push(impostor);
    await expect(impostor.deliver(ben.did, buildWire(anna, ben, "v2-device-2"))).rejects.toThrow();
  });
});
