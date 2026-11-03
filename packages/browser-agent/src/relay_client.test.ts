// @vitest-environment node
//
// relay_client.test.ts — real round-trips against a live transport
// RelayServer (mirrors transport's own relay_channel.test.ts discipline:
// real listeners, poll-don't-assert-immediately). Run under the "node"
// vitest environment (not this package's default jsdom) because the round
// trip needs Node's real `fetch`/`http` stack talking to a real listening
// RelayServer — jsdom's fetch/WebSocket shims are partial and not needed
// here; the browser-vs-Node WebSocket API seam is exactly what `wsCtor`
// exists to bridge (see relay_client.ts's file header).
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  RelayServer,
  createIdentity,
  packMessage as transportPackMessage,
  unpackMessage as transportUnpackMessage,
} from "@resource-web/transport";
import { generateIdentity } from "./identity.js";
import { fromBase64url, toBase64url } from "./identity.js";
import { packMessage, unpackMessage } from "./didcomm_crypto.js";
import { createRelayClient, ENVELOPE_TYPE, type RelayClient } from "./relay_client.js";

const servers: RelayServer[] = [];
const clients: RelayClient[] = [];
const rawSockets: WsWebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of clients.splice(0)) c.stop();
  for (const raw of rawSockets.splice(0)) {
    if (raw.readyState === WsWebSocket.OPEN || raw.readyState === WsWebSocket.CONNECTING) raw.terminate();
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

// Every relay here REQUIRES sender auth, so each accepted send proves the browser's v2 signature (aud = the relay
// origin; the server derives its expected audience from the Host header fetch sets) verifies on the real server.
async function bootRelay(): Promise<{ relay: RelayServer; endpoint: string }> {
  const relay = new RelayServer({ senderAuth: "required" });
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, endpoint: `http://127.0.0.1:${port}` };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("createRelayClient — send/onInbound round trip", () => {
  it("A sends to B; B drains, decrypts, and sees A's DID via from-binding", async () => {
    const anna = generateIdentity({ endpoint: "https://relay.invalid/anna" });
    const ben = generateIdentity({ endpoint: "https://relay.invalid/ben" });
    const { endpoint } = await bootRelay();

    const clientA = createRelayClient({ identity: anna, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientA);
    const clientB = createRelayClient({ identity: ben, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientB);

    const received: { from: string; envelope: unknown }[] = [];
    clientB.onInbound((from, envelope) => received.push({ from, envelope }));
    await clientB.start();

    const envelope = { kind: "REQUEST", text: "may I borrow the drill?" };
    await clientA.send(ben.did, envelope);

    await waitFor(() => received.length >= 1);
    expect(received[0]!.from).toBe(anna.did);
    expect(received[0]!.envelope).toEqual(envelope);
  });

  it("delivers a wire that was queued before the recipient's client ever started draining", async () => {
    const anna = generateIdentity();
    const ben = generateIdentity();
    const { endpoint } = await bootRelay();

    const clientA = createRelayClient({ identity: anna, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientA);
    await clientA.send(ben.did, { queued: true });

    const received: { from: string; envelope: unknown }[] = [];
    const clientB = createRelayClient({ identity: ben, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientB);
    clientB.onInbound((from, envelope) => received.push({ from, envelope }));
    await clientB.start();

    await waitFor(() => received.length >= 1);
    expect(received[0]!.from).toBe(anna.did);
    expect(received[0]!.envelope).toEqual({ queued: true });
  });

  it("send() throws when the relay rejects the wire (no route to the recipient)", async () => {
    const anna = generateIdentity();
    const stranger = generateIdentity();
    const relay = new RelayServer({ senderAuth: "required", isRoutable: (did) => did !== stranger.did });
    servers.push(relay);
    const { port } = await relay.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${port}`;

    const clientA = createRelayClient({ identity: anna, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientA);

    await expect(clientA.send(stranger.did, { hello: "world" })).rejects.toThrow(/rejected/);
  });
});

describe("createRelayClient — v2 sender auth", () => {
  /** Counts ingress POSTs (and keeps their headers) while letting them reach the real relay. */
  function spyOnIngress(): Array<Record<string, string>> {
    const seen: Array<Record<string, string>> = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (init?.method === "POST") seen.push({ ...((init.headers as Record<string, string> | undefined) ?? {}) });
      return realFetch(input, init);
    });
    return seen;
  }

  it("signs for the relay's origin (x-tw-relay-aud) and the relay requiring auth accepts it", async () => {
    const anna = generateIdentity();
    const ben = generateIdentity();
    const { endpoint } = await bootRelay();
    const seen = spyOnIngress();

    const clientA = createRelayClient({ identity: anna, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientA);
    await clientA.send(ben.did, { hello: "v2" });

    expect(seen).toHaveLength(1);
    expect(seen[0]!["x-tw-relay-aud"]).toBe(endpoint);
    expect(seen[0]!["x-tw-relay-did"]).toBe(anna.did);
  });

  it("a client whose clock is 10 minutes fast recovers: 401 stale, then ONE retry on the relay's Date clock", async () => {
    const anna = generateIdentity();
    const ben = generateIdentity();
    const { endpoint } = await bootRelay();
    const seen = spyOnIngress();

    const skewMs = 10 * 60_000;
    const clientA = createRelayClient({ identity: anna, relayUrl: endpoint, wsCtor: WsWebSocket, now: () => Date.now() + skewMs });
    clients.push(clientA);
    await clientA.send(ben.did, { skewed: true });

    expect(seen).toHaveLength(2);
    const firstTs = Number(seen[0]!["x-tw-relay-ts"]);
    const retryTs = Number(seen[1]!["x-tw-relay-ts"]);
    expect(firstTs - retryTs).toBeGreaterThan(skewMs - 5_000); // moved back by ~the skew (Date has 1 s resolution)

    const received: { from: string; envelope: unknown }[] = [];
    const clientB = createRelayClient({ identity: ben, relayUrl: endpoint, wsCtor: WsWebSocket });
    clients.push(clientB);
    clientB.onInbound((from, envelope) => received.push({ from, envelope }));
    await clientB.start();
    await waitFor(() => received.length >= 1);
    expect(received[0]!).toEqual({ from: anna.did, envelope: { skewed: true } });
  });
});

describe("createRelayClient — drain auth", () => {
  it("a drain attempt signed with the wrong key for the claimed DID is rejected by the server", async () => {
    const ben = generateIdentity();
    const mallory = generateIdentity();
    const { endpoint } = await bootRelay();

    const wsUrl = endpoint.replace(/^http/, "ws") + "/relay/drain";
    const raw = new WsWebSocket(wsUrl);
    rawSockets.push(raw);
    const messages: { type: string; nonce?: string }[] = [];
    let resolveChallenge!: (nonce: string) => void;
    const challenge = new Promise<string>((resolve) => {
      resolveChallenge = resolve;
    });
    raw.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; nonce?: string };
      messages.push(msg);
      if (msg.type === "challenge" && msg.nonce) resolveChallenge(msg.nonce);
    });
    await new Promise<void>((resolve, reject) => {
      raw.once("open", () => resolve());
      raw.once("error", reject);
    });

    const nonce = await challenge;
    // Impersonation attempt: claim Ben's DID but sign with Mallory's key.
    const sig = ed25519.sign(fromBase64url(nonce), mallory.signingSecretKey);
    raw.send(JSON.stringify({ type: "auth", did: ben.did, sig: toBase64url(sig) }));

    await waitFor(() => messages.some((m) => m.type === "auth_failed"));
    await waitFor(() => raw.readyState === WsWebSocket.CLOSED || raw.readyState === WsWebSocket.CLOSING);
  });
});

describe("didcomm_crypto (browser port) — tamper detection", () => {
  it("a tampered ciphertext byte fails to unpack", () => {
    const anna = generateIdentity();
    const ben = generateIdentity();
    const wire = packMessage({
      sender: anna,
      recipientDid: ben.did,
      message: {
        id: "tamper-1",
        type: ENVELOPE_TYPE,
        from: anna.did,
        to: [ben.did],
        created_time: Date.now(),
        body: { hello: "world" },
      },
    });

    const parsed = JSON.parse(wire) as { ciphertext: string };
    // Flip an INTERIOR character, never the last one: an unpadded base64url
    // string's final character can carry unused low bits when the encoded
    // byte length isn't a multiple of 3, so flipping it sometimes decodes to
    // the SAME bytes (a spuriously non-flaky-looking pass that isn't
    // actually testing tamper detection). An interior character always
    // encodes 6 significant bits, so flipping it always changes the
    // decoded byte and always fails the AEAD tag.
    const firstChar = parsed.ciphertext[0];
    const flipped = firstChar === "A" ? "B" : "A";
    const tampered = { ...parsed, ciphertext: flipped + parsed.ciphertext.slice(1) };

    expect(() => unpackMessage({ recipient: ben, wire: JSON.stringify(tampered) })).toThrow();
  });
});

describe("didcomm_crypto (browser port) — cross-implementation interop with transport", () => {
  // The browser<->browser round trip above proves the base64url/HKDF/AEAD
  // plumbing is internally consistent, and the drain-auth handshake proves
  // browser base64url agrees with transport's (auth_ok wouldn't fire
  // otherwise). These two tests go further and prove the actual production
  // path: a browser identity and a transport (Node daemon) identity resolving
  // and decrypting EACH OTHER's wires, byte-for-byte, via the two
  // independent didcomm_crypto.ts implementations.
  it("a wire packed by the browser client is decrypted by transport's unpackMessage (browser -> Node peer)", () => {
    const annaBrowser = generateIdentity({ endpoint: "https://relay.invalid/anna" });
    const benTransport = createIdentity("http://ben.example/didcomm");

    const wire = packMessage({
      sender: annaBrowser,
      recipientDid: benTransport.did,
      message: {
        id: "interop-browser-to-node",
        type: ENVELOPE_TYPE,
        from: annaBrowser.did,
        to: [benTransport.did],
        created_time: Date.now(),
        body: { hello: "from-browser" },
      },
    });

    const result = transportUnpackMessage({ recipient: benTransport, wire });
    expect(result.from).toBe(annaBrowser.did);
    expect(result.message.body).toEqual({ hello: "from-browser" });
  });

  it("a wire packed by transport's packMessage is decrypted by the browser's unpackMessage (Node peer -> browser)", () => {
    const annaTransport = createIdentity("http://anna.example/didcomm");
    const benBrowser = generateIdentity({ endpoint: "https://relay.invalid/ben" });

    const wire = transportPackMessage({
      sender: annaTransport,
      recipientDid: benBrowser.did,
      message: {
        id: "interop-node-to-browser",
        type: ENVELOPE_TYPE,
        from: annaTransport.did,
        to: [benBrowser.did],
        created_time: Date.now(),
        body: { hello: "from-node" },
      },
    });

    const result = unpackMessage({ recipient: benBrowser, wire });
    expect(result.from).toBe(annaTransport.did);
    expect(result.message.body).toEqual({ hello: "from-node" });
  });
});
