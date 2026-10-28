// Real RelayServer over real localhost HTTP: POST /relay/send must carry a
// valid per-DID signature. Forged, replayed, unsigned and valid sends, plus
// the staged-rollout "optional" mode and the allow-list hook. Fresh generated
// identities only.
import { describe, it, expect, afterEach } from "vitest";
import { createIdentity, type Identity } from "./did_identity.js";
import { packMessage } from "./didcomm_crypto.js";
import { ENVELOPE_TYPE } from "./didcomm_transport.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import { RelayServer, type RelayServerOptions } from "./relay_server.js";
import { InMemoryRelayQueueStore } from "./relay_queue_store.js";
import { SEND_AUTH_HEADERS, signSend } from "./relay_send_auth.js";

const servers: RelayServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function boot(opts?: RelayServerOptions) {
  const queueStore = new InMemoryRelayQueueStore();
  const relay = new RelayServer({ queueStore, ...opts });
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, port, queueStore };
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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /relay/send sender authentication (default: required)", () => {
  it("accepts a validly signed send and queues it for the recipient", async () => {
    const { port, queueStore } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire));
    expect(res).toEqual({ status: 202, body: { routed: "accepted" } });
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("rejects an unsigned send (401) and queues nothing", async () => {
    const { port, queueStore } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const res = await post(port, wireFor(alice, bob));
    expect(res.status).toBe(401);
    expect(queueStore.count(bob.did)).toBe(0);
  });

  it("rejects a send forged under the victim's DID with the attacker's key (401) and queues nothing", async () => {
    const { port, queueStore } = await boot();
    const victim = createIdentity("http://127.0.0.1:1");
    const attacker = createIdentity("http://127.0.0.1:3");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(attacker, bob);
    const res = await post(port, wire, signSend({ did: victim.did, signing: attacker.signing }, wire));
    expect(res.status).toBe(401);
    expect(queueStore.count(bob.did)).toBe(0);
  });

  it("rejects a captured request replayed verbatim: exactly one copy is ever queued", async () => {
    const { port, queueStore } = await boot();
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const headers = signSend(alice, wire);
    expect((await post(port, wire, headers)).status).toBe(202);
    const replay = await post(port, wire, headers);
    expect(replay.status).toBe(401);
    expect(queueStore.count(bob.did)).toBe(1);
  });

  it("rejects a stale capture (timestamp outside the window)", async () => {
    const { port } = await boot({ senderAuthWindowMs: 60_000 });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire, { now: Date.now() - 120_000 }));
    expect(res.status).toBe(401);
  });

  it("authenticates before routing: an unsigned send to an unroutable DID gets 401, not a routing verdict", async () => {
    const { port } = await boot({ isRoutable: () => false });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    expect((await post(port, wireFor(alice, bob))).status).toBe(401);
  });

  it("a signed send to an unroutable DID still gets the existing 404 rejected verdict", async () => {
    const { port } = await boot({ isRoutable: () => false });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire));
    expect(res.status).toBe(404);
    expect(res.body.routed).toBe("rejected");
  });

  it("allow-list hook: a validly signed send from a non-allowed DID gets 403", async () => {
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    const { port, queueStore } = await boot({ isAllowedSender: (did) => did !== alice.did });
    const wire = wireFor(alice, bob);
    const res = await post(port, wire, signSend(alice, wire));
    expect(res.status).toBe(403);
    expect(queueStore.count(bob.did)).toBe(0);
  });
});

describe("senderAuth modes", () => {
  it('"optional": unsigned passes (staged rollout) but a present-and-invalid signature is still rejected', async () => {
    const { port, queueStore } = await boot({ senderAuth: "optional" });
    const alice = createIdentity("http://127.0.0.1:1");
    const attacker = createIdentity("http://127.0.0.1:3");
    const bob = createIdentity("http://127.0.0.1:2");
    const wire = wireFor(alice, bob, "u1");
    expect((await post(port, wire)).status).toBe(202);
    const wire2 = wireFor(alice, bob, "u2");
    const bad = signSend({ did: alice.did, signing: attacker.signing }, wire2);
    expect((await post(port, wire2, bad)).status).toBe(401);
    const good = signSend(alice, wire2);
    expect((await post(port, wire2, good)).status).toBe(202);
    expect(queueStore.count(bob.did)).toBe(2);
    expect(Object.keys(good).sort()).toEqual(Object.values(SEND_AUTH_HEADERS).sort());
  });

  it('"off": legacy behaviour, unsigned accepted', async () => {
    const { port } = await boot({ senderAuth: "off" });
    const alice = createIdentity("http://127.0.0.1:1");
    const bob = createIdentity("http://127.0.0.1:2");
    expect((await post(port, wireFor(alice, bob))).status).toBe(202);
  });
});
