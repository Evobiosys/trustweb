// Wave 11: the relay wakes a subscribed phone through Web Push when a wire waits for it (relay_server.ts push,
// web_push.ts). The push service is a fake here; what is checked is WHEN a wake goes out, that it carries nothing,
// and that a VAPID token verifies against the public key the phone subscribed with.
import { describe, it, expect, afterEach } from "vitest";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createIdentity } from "./did_identity.js";
import { RelayServer } from "./relay_server.js";
import { InMemoryPushSubscriptionStore } from "./push_store.js";
import { generateVapidKeys, loadVapidKeys, parsePushSubscription, sendWake, vapidAuthorization, type PushSubscriptionJson, type WakeOutcome } from "./web_push.js";

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const SUB: PushSubscriptionJson = { endpoint: "https://push.example.test/send/abc", keys: { p256dh: "BPub", auth: "auth" } };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function boot(opts: { ackWaitMs?: number; coalesceMs?: number; outcome?: WakeOutcome } = {}) {
  const store = new InMemoryPushSubscriptionStore();
  const wakes: PushSubscriptionJson[] = [];
  const relay = new RelayServer({
    push: {
      store,
      vapid: generateVapidKeys("mailto:test@example.test"),
      send: async (sub) => {
        wakes.push(sub);
        return opts.outcome ?? "sent";
      },
      ackWaitMs: opts.ackWaitMs ?? 100,
      coalesceMs: opts.coalesceMs ?? 300,
    },
  });
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, store, wakes, endpoint: `http://127.0.0.1:${port}` };
}

/** An authenticated drain that answers `auth` and, when asked, acks every wire. */
async function drain(endpoint: string, did: ReturnType<typeof createIdentity>, ack: boolean) {
  const ws = new WebSocket(endpoint.replace("http", "ws") + "/relay/drain");
  sockets.push(ws);
  const frames: Record<string, unknown>[] = [];
  const authed = new Promise<void>((resolve, reject) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      frames.push(msg);
      if (msg.type === "challenge") {
        const sig = ed25519.sign(new Uint8Array(Buffer.from(msg.nonce as string, "base64url")), did.signing.secretKey);
        ws.send(JSON.stringify({ type: "auth", did: did.did, sig: Buffer.from(sig).toString("base64url") }));
      } else if (msg.type === "auth_ok") resolve();
      else if (msg.type === "auth_failed") reject(new Error("auth failed"));
      else if (msg.type === "wire" && ack) ws.send(JSON.stringify({ type: "ack", ids: [msg.id] }));
    });
  });
  await authed;
  return { ws, frames, until: async (type: string) => { while (!frames.some((f) => f.type === type)) await sleep(10); return frames.find((f) => f.type === type)!; } };
}

describe("relay push wake-ups", () => {
  it("keeps a subscription only from an authenticated drain and serves its public key", async () => {
    const { relay, store, endpoint } = await boot();
    const me = createIdentity(endpoint);
    const res = await fetch(endpoint + "/relay/push/key");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { publicKey: string }).publicKey).toBe(relay.pushPublicKey());

    const d = await drain(endpoint, me, true);
    d.ws.send(JSON.stringify({ type: "push", subscription: SUB }));
    expect((await d.until("push_ok")).kept).toBe(true);
    expect(store.get(me.did)).toEqual(SUB);

    d.ws.send(JSON.stringify({ type: "push", subscription: { endpoint: "http://insecure.test/x" } }));
    await d.until("push_rejected");
    expect(store.get(me.did)).toEqual(SUB);

    d.ws.send(JSON.stringify({ type: "push", subscription: null }));
    await sleep(50);
    expect(store.get(me.did)).toBeNull();
  });

  it("wakes a phone with no drain open, once per coalescing window, and drops a gone subscription", async () => {
    const { relay, store, wakes } = await boot({ outcome: "sent" });
    const me = createIdentity("http://relay.test");
    store.set(me.did, SUB);
    expect(relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "a" })).routed).toBe("accepted");
    relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "b" }));
    await sleep(30);
    expect(wakes).toEqual([SUB]);
    await sleep(320);
    relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "c" }));
    await sleep(30);
    expect(wakes.length).toBe(2);

    const gone = await boot({ outcome: "gone" });
    gone.store.set(me.did, SUB);
    gone.relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "d" }));
    await sleep(30);
    expect(gone.store.get(me.did)).toBeNull();
  });

  it("does not wake a phone whose open drain acks, but does wake one whose drain stays silent", async () => {
    const { relay, store, wakes, endpoint } = await boot({ ackWaitMs: 80 });
    const awake = createIdentity(endpoint);
    const frozen = createIdentity(endpoint);
    store.set(awake.did, SUB);
    store.set(frozen.did, { ...SUB, endpoint: "https://push.example.test/send/frozen" });
    await drain(endpoint, awake, true);
    await drain(endpoint, frozen, false);
    relay.submit(JSON.stringify({ to: awake.did, from: "x", payload: "a" }));
    relay.submit(JSON.stringify({ to: frozen.did, from: "x", payload: "b" }));
    await sleep(200);
    expect(wakes.map((w) => w.endpoint)).toEqual(["https://push.example.test/send/frozen"]);
  });

  it("a relay without push answers push_unavailable and 404s the key", async () => {
    const relay = new RelayServer();
    servers.push(relay);
    const { port } = await relay.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${port}`;
    expect((await fetch(endpoint + "/relay/push/key")).status).toBe(404);
    const d = await drain(endpoint, createIdentity(endpoint), true);
    d.ws.send(JSON.stringify({ type: "push", subscription: SUB }));
    await d.until("push_unavailable");
  });
});

describe("web_push", () => {
  it("mints keys that load back and signs a VAPID token the public key verifies", () => {
    const keys = generateVapidKeys("mailto:a@b.test");
    const loaded = loadVapidKeys(JSON.parse(JSON.stringify(keys)));
    expect(loaded.publicKey).toBe(keys.publicKey);
    expect(Buffer.from(keys.publicKey, "base64url").length).toBe(65);

    const auth = vapidAuthorization(keys, "https://fcm.googleapis.com/fcm/send/abc", 1_700_000_000_000);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(keys.publicKey);
    const [h, c, s] = m![1].split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString()) as { aud: string; exp: number; sub: string };
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:a@b.test");
    expect(claims.exp - 1_700_000_000).toBe(12 * 3600);
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: keys.privateJwk.x, y: keys.privateJwk.y }, format: "jwk" });
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
    expect(() => loadVapidKeys({ ...keys, publicKey: "BAAA" })).toThrow();
  });

  it("sends a payload-free POST and maps the push service's answer", async () => {
    const keys = generateVapidKeys("mailto:a@b.test");
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status });
    }) as typeof fetch;
    expect(await sendWake(SUB, keys, fake(201))).toBe("sent");
    expect(await sendWake(SUB, keys, fake(410))).toBe("gone");
    expect(await sendWake(SUB, keys, fake(500))).toBe("failed");
    expect(seen[0].url).toBe(SUB.endpoint);
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.body).toBeUndefined();
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.TTL).toBe("86400");
    expect(headers.Authorization.startsWith("vapid t=")).toBe(true);
    expect(await sendWake(SUB, keys, (async () => { throw new Error("offline"); }) as typeof fetch)).toBe("failed");
  });

  it("accepts only an https subscription", () => {
    expect(parsePushSubscription(SUB)).toEqual(SUB);
    expect(parsePushSubscription({ endpoint: "https://p.test/x" })).toEqual({ endpoint: "https://p.test/x" });
    expect(parsePushSubscription({ endpoint: "http://p.test/x" })).toBeNull();
    expect(parsePushSubscription({ endpoint: 5 })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
  });
});
