// Wave 11: the relay wakes a subscribed phone through Web Push when a wire waits for it (relay_server.ts push,
// web_push.ts). The push service is a fake here; what is checked is WHEN a wake goes out, that it carries nothing,
// and that a VAPID token verifies against the public key the phone subscribed with.
import { describe, it, expect, afterEach } from "vitest";
import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { createServer as createHttp2Server } from "node:http2";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createIdentity } from "./did_identity.js";
import { RelayServer } from "./relay_server.js";
import { InMemoryPushSubscriptionStore } from "./push_store.js";
import { generateVapidKeys, loadVapidKeys, parsePushSubscription, sendWake, vapidAuthorization, type PushSubscriptionJson, type WakeOutcome } from "./web_push.js";
import { APNS_PAYLOAD, apnsProviderToken, loadApnsConfig, parseApnsTarget, sendApns, type ApnsConfig, type ApnsTarget } from "./apns_push.js";

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

  it("a peek auth streams the queue once, acks nothing, never displaces the live drain, and may hand over a subscription", async () => {
    const { relay, store, endpoint } = await boot();
    const me = createIdentity(endpoint);
    const live = await drain(endpoint, me, false); // alive in the background: acks nothing
    relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "a" }));
    relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "b" }));
    await live.until("wire");

    const ws = new WebSocket(endpoint.replace("http", "ws") + "/relay/drain");
    sockets.push(ws);
    const frames: Record<string, unknown>[] = [];
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      frames.push(m);
      if (m.type === "challenge") {
        const sig = ed25519.sign(new Uint8Array(Buffer.from(m.nonce as string, "base64url")), me.signing.secretKey);
        ws.send(JSON.stringify({ type: "auth", did: me.did, sig: Buffer.from(sig).toString("base64url"), peek: true }));
      }
      if (m.type === "wire") ws.send(JSON.stringify({ type: "ack", ids: [m.id] })); // ignored on a peek
      if (m.type === "peek_end") ws.send(JSON.stringify({ type: "push", subscription: SUB }));
    });
    await closed;
    expect(frames.map((f) => f.type)).toEqual(["challenge", "auth_ok", "wire", "wire", "peek_end", "push_ok"]);
    expect(live.ws.readyState).toBe(WebSocket.OPEN); // not displaced
    expect(store.get(me.did)).toEqual(SUB);
    live.ws.send(JSON.stringify({ type: "ack", ids: frames.filter((f) => f.type === "wire").map((f) => f.id as string) }));
    await sleep(50);
    expect(relay.submit(JSON.stringify({ to: me.did, from: "x", payload: "c" })).routed).toBe("accepted");
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

// Wave 12 (apns_push.ts): an iPhone hands over an APNs device token instead of a Web Push subscription; the relay wakes it
// through Apple with a constant payload that names no sender, kind or count.
describe("relay apns wake-ups", () => {
  const TOKEN = "ab".repeat(32);
  const KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const CFG: ApnsConfig = { keyId: "KEY1234567", teamId: "TEAM123456", topic: "one.trustweb.app", privateKey: KEY.privateKey.export({ type: "pkcs8", format: "pem" }) as string };

  it("keeps a token only when the relay has Apple credentials, and routes the wake to the APNs sender", async () => {
    const without = await boot();
    const me = createIdentity(without.endpoint);
    const d = await drain(without.endpoint, me, true);
    d.ws.send(JSON.stringify({ type: "push", subscription: { apns: TOKEN } }));
    expect((await d.until("push_rejected")).reason).toMatch(/Apple/);
    expect(without.store.get(me.did)).toBeNull();

    const store = new InMemoryPushSubscriptionStore();
    const woken: ApnsTarget[] = [];
    const relay = new RelayServer({ push: { store, vapid: generateVapidKeys("mailto:t@e.test"), apns: CFG, sendApns: async (t) => { woken.push(t); return "sent"; }, send: async () => { throw new Error("web sender must not run"); } } });
    servers.push(relay);
    const { port } = await relay.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${port}`;
    const phone = createIdentity(endpoint);
    const d2 = await drain(endpoint, phone, true);
    d2.ws.send(JSON.stringify({ type: "push", subscription: { apns: TOKEN.toUpperCase() } }));
    expect((await d2.until("push_ok")).kept).toBe(true);
    expect(store.get(phone.did)).toEqual({ apns: TOKEN });
    d2.ws.terminate();
    await sleep(50);
    relay.submit(JSON.stringify({ to: phone.did, from: "x", payload: "a" }));
    await sleep(30);
    expect(woken).toEqual([{ apns: TOKEN }]);
  });

  it("signs a provider token Apple's public key verifies, and parses only a hex device token", () => {
    const [h, c, s] = apnsProviderToken(CFG, 1_700_000_000_000).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${c}`), { key: KEY.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
    expect(parseApnsTarget({ apns: TOKEN })).toEqual({ apns: TOKEN });
    expect(parseApnsTarget({ apns: "not-hex" })).toBeNull();
    expect(parsePushSubscription({ apns: TOKEN })).toEqual({ apns: TOKEN });
    expect(() => loadApnsConfig({ ...CFG, privateKey: "nope" })).toThrow();
    expect(() => loadApnsConfig({ ...CFG, topic: "" })).toThrow();
  });

  it("POSTs the constant alert over HTTP/2 and maps Apple's answer", async () => {
    const seen: { path: string; headers: Record<string, string>; body: string }[] = [];
    let answer: { status: number; body?: string } = { status: 200 };
    const server = createHttp2Server((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => { body += c; });
      req.on("end", () => {
        seen.push({ path: req.url, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !k.startsWith(":")).map(([k, v]) => [k, String(v)])), body });
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(answer.body ?? "");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const cfg = { ...CFG, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
    try {
      expect(await sendApns({ apns: TOKEN }, cfg)).toBe("sent");
      expect(seen[0].path).toBe(`/3/device/${TOKEN}`);
      expect(seen[0].body).toBe(APNS_PAYLOAD);
      expect(JSON.parse(seen[0].body)).toEqual({ aps: { alert: { title: "TrustWeb", body: "Something arrived for you" }, sound: "default", "thread-id": "trustweb" } });
      expect(seen[0].headers["apns-topic"]).toBe("one.trustweb.app");
      expect(seen[0].headers["apns-push-type"]).toBe("alert");
      expect(seen[0].headers.authorization.startsWith("bearer ")).toBe(true);
      answer = { status: 410, body: JSON.stringify({ reason: "Unregistered" }) };
      expect(await sendApns({ apns: TOKEN }, cfg)).toBe("gone");
      answer = { status: 403, body: JSON.stringify({ reason: "InvalidProviderToken" }) };
      expect(await sendApns({ apns: TOKEN }, cfg)).toBe("failed");
    } finally {
      server.close();
    }
    expect(await sendApns({ apns: TOKEN }, { ...CFG, endpoint: "http://127.0.0.1:1" })).toBe("failed");
  });
});
