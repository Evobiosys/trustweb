// iroh_relay_channel.test.ts — IrohRelayChannel against an in-memory fake
// IrohEndpointLike. No network, no native module, no personal data: peers are
// synthetic ids ("node-a", "did:peer:test-…").
import { describe, it, expect } from "vitest";
import {
  IrohRelayChannel,
  DEFAULT_ATTEMPT_MS,
  DEFAULT_MAX_RELAY_ATTEMPTS,
  type IrohEndpointLike,
  type IrohPeerAddr,
  type IrohRelayAuditEvent,
} from "./iroh_relay_channel.js";
import { IrohRelaySelector } from "./iroh_relay_selector.js";
import { LadderChannel } from "./ladder_channel.js";
import type { DeliveryChannel } from "./delivery_channel.js";

class FakeEndpoint implements IrohEndpointLike {
  /** Every send attempt, in order (recorded before the outcome is decided). */
  sent: { addr: IrohPeerAddr; payload: Uint8Array }[] = [];
  cb: ((p: Uint8Array) => void) | null = null;
  closed = false;
  failWith: Error | null = null;
  /** Per-relay outcome, keyed by the single relay url of an attempt ("" = direct-only). */
  byRelay = new Map<string, Error | "hang">();
  async send(addr: IrohPeerAddr, payload: Uint8Array): Promise<void> {
    this.sent.push({ addr, payload });
    if (this.failWith) throw this.failWith;
    const outcome = this.byRelay.get(addr.relayUrls?.[0] ?? "");
    if (outcome === "hang") {
      // Settles (rejects) only well after any test's attemptMs: exercises the late-loser guard.
      await new Promise((r) => setTimeout(r, 120));
      throw new Error("late failure after abandonment");
    }
    if (outcome) throw outcome;
  }
  onReceive(cb: (p: Uint8Array) => void): void {
    this.cb = cb;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

const PEER = "did:peer:test-ben";
const PEER_RELAY = "https://relay.peer.example";
const ONE = "https://relay.one.example";
const TWO = "https://relay.two.example";
const THREE = "https://relay.three.example";
const DIRECT = ["192.0.2.10:4433"];
const resolve = (did: string): IrohPeerAddr | undefined =>
  did === PEER ? { nodeId: "node-b", relayUrls: [PEER_RELAY] } : undefined;
const resolveDirect = (did: string): IrohPeerAddr | undefined =>
  did === PEER ? { nodeId: "node-b", relayUrls: [PEER_RELAY], directAddrs: DIRECT } : undefined;

describe("IrohRelayChannel", () => {
  it("delivers the wire verbatim as utf-8 bytes to the resolved node", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    await ch.deliver(PEER, '{"wire":"é"}');
    expect(ep.sent).toHaveLength(1);
    expect(ep.sent[0].addr.nodeId).toBe("node-b");
    expect(new TextDecoder().decode(ep.sent[0].payload)).toBe('{"wire":"é"}');
  });

  it("sends one attempt per relay, each with a single relayUrl: peer's first, then own, no duplicates", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("peer relay down"));
    ep.byRelay.set(ONE, new Error("one down"));
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE, PEER_RELAY, TWO] });
    await ch.deliver(PEER, "w");
    expect(ep.sent.map((s) => s.addr.relayUrls)).toEqual([[PEER_RELAY], [ONE], [TWO]]);
    expect(ep.sent.every((s) => s.addr.nodeId === "node-b")).toBe(true);
  });

  it("passes the peer's directAddrs on every attempt", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("down"));
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolveDirect, relayUrls: [ONE] });
    await ch.deliver(PEER, "w");
    expect(ep.sent.map((s) => s.addr.directAddrs)).toEqual([DIRECT, DIRECT]);
  });

  it("fails over to the next relay when the first rejects", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("peer relay down"));
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE] });
    await expect(ch.deliver(PEER, "w")).resolves.toBeUndefined();
    expect(ep.sent.map((s) => s.addr.relayUrls![0])).toEqual([PEER_RELAY, ONE]);
  });

  it("a relay that failed goes last on the next deliver (cooldown)", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("peer relay down"));
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE] });
    await ch.deliver(PEER, "w1");
    ep.sent = [];
    ep.byRelay.clear();
    await ch.deliver(PEER, "w2");
    expect(ep.sent.map((s) => s.addr.relayUrls![0])).toEqual([ONE]);
  });

  it("a shared selector carries relay health across channels", async () => {
    const selector = new IrohRelaySelector();
    selector.reportFailure(PEER_RELAY);
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE], selector });
    await ch.deliver(PEER, "w");
    expect(ep.sent.map((s) => s.addr.relayUrls![0])).toEqual([ONE]);
  });

  it("abandons a relay that hangs after attemptMs and tries the next one", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, "hang");
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE], attemptMs: 30 });
    const t0 = Date.now();
    await ch.deliver(PEER, "w");
    expect(Date.now() - t0).toBeLessThan(110);
    expect(ep.sent.map((s) => s.addr.relayUrls![0])).toEqual([PEER_RELAY, ONE]);
    // let the abandoned send reject late; the guard must keep it from surfacing as unhandled
    await new Promise((r) => setTimeout(r, 150));
  });

  it("caps the number of relays tried at maxRelayAttempts", async () => {
    const ep = new FakeEndpoint();
    ep.failWith = new Error("down");
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE, TWO, THREE], maxRelayAttempts: 2 });
    await expect(ch.deliver(PEER, "w")).rejects.toThrow(/all 2 relay attempts failed/);
    expect(ep.sent).toHaveLength(2);
    const dflt = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE, TWO, THREE] });
    ep.sent = [];
    await expect(dflt.deliver(PEER, "w")).rejects.toThrow();
    expect(ep.sent).toHaveLength(DEFAULT_MAX_RELAY_ATTEMPTS);
    expect(DEFAULT_MAX_RELAY_ATTEMPTS).toBe(3);
    expect(DEFAULT_ATTEMPT_MS).toBe(10_000);
  });

  it("makes exactly one direct-only attempt when no relay is known at all", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: () => ({ nodeId: "node-b", directAddrs: DIRECT }) });
    await ch.deliver(PEER, "w");
    expect(ep.sent).toHaveLength(1);
    expect(ep.sent[0].addr).toEqual({ nodeId: "node-b", relayUrls: [], directAddrs: DIRECT });
  });

  it("aggregates every attempt's failure into one error", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("peer relay down"));
    ep.byRelay.set(ONE, new Error("one refused"));
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE] });
    await expect(ch.deliver(PEER, "w")).rejects.toThrow(
      `IrohRelayChannel.deliver: all 2 relay attempts failed for ${PEER} (${PEER_RELAY}: peer relay down; ${ONE}: one refused)`
    );
    const direct = new IrohRelayChannel({ endpoint: ep, resolvePeer: () => ({ nodeId: "node-b" }) });
    ep.byRelay.set("", new Error("no path"));
    await expect(direct.deliver(PEER, "w")).rejects.toThrow(
      `IrohRelayChannel.deliver: all 1 relay attempts failed for ${PEER} (direct: no path)`
    );
  });

  it("emits a human-readable audit trail with no wire content (I6)", async () => {
    const ep = new FakeEndpoint();
    ep.byRelay.set(PEER_RELAY, new Error("peer relay down"));
    const events: IrohRelayAuditEvent[] = [];
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, relayUrls: [ONE], onAudit: (e) => events.push(e) });
    const wire = '{"ciphertext":"SECRET-WIRE-BYTES"}';
    await ch.deliver(PEER, wire);
    expect(events.map((e) => [e.kind, e.relayUrl, e.attempt])).toEqual([
      ["attempt", PEER_RELAY, 1],
      ["failed", PEER_RELAY, 1],
      ["attempt", ONE, 2],
      ["delivered", ONE, 2],
    ]);
    expect(events[1].error).toBe("peer relay down");
    expect(typeof events[3].ms).toBe("number");
    for (const e of events) {
      expect(e.recipientDid).toBe(PEER);
      expect(e.text.length).toBeGreaterThan(0);
      expect(e.text).not.toContain("SECRET-WIRE-BYTES");
      expect(JSON.stringify(e)).not.toContain("SECRET-WIRE-BYTES");
    }
  });

  it("audits gave_up after the last failed attempt", async () => {
    const ep = new FakeEndpoint();
    ep.failWith = new Error("down");
    const events: IrohRelayAuditEvent[] = [];
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, onAudit: (e) => events.push(e) });
    await expect(ch.deliver(PEER, "w")).rejects.toThrow();
    expect(events.map((e) => e.kind)).toEqual(["attempt", "failed", "gave_up"]);
    expect(events[2].text.length).toBeGreaterThan(0);
  });

  it("a throwing onAudit sink never breaks delivery", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, onAudit: () => { throw new Error("sink broke"); } });
    await expect(ch.deliver(PEER, "w")).resolves.toBeUndefined();
  });

  it("rejects when the recipient has no iroh address", async () => {
    const ch = new IrohRelayChannel({ endpoint: new FakeEndpoint(), resolvePeer: resolve });
    await expect(ch.deliver("did:peer:test-unknown", "w")).rejects.toThrow(/no iroh address/);
  });

  it("rejects an empty or oversize wire before touching the endpoint", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve, maxWireBytes: 8 });
    await expect(ch.deliver(PEER, "")).rejects.toThrow(/empty/);
    await expect(ch.deliver(PEER, "123456789")).rejects.toThrow(/exceeds/);
    expect(ep.sent).toHaveLength(0);
  });

  it("propagates endpoint failures so a ladder can fall through", async () => {
    const ep = new FakeEndpoint();
    ep.failWith = new Error("relay down");
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    await expect(ch.deliver(PEER, "w")).rejects.toThrow(/relay down/);
  });

  it("hands inbound bytes to the sink as the original wire string", () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    const got: string[] = [];
    ch.onInbound((w) => got.push(w));
    ep.cb!(new TextEncoder().encode("wire-1"));
    expect(got).toEqual(["wire-1"]);
  });

  it("drops inbound payloads that are not valid utf-8 instead of throwing", () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    const got: string[] = [];
    ch.onInbound((w) => got.push(w));
    expect(() => ep.cb!(new Uint8Array([0xff, 0xfe]))).not.toThrow();
    expect(got).toEqual([]);
  });

  it("isAvailable defers to the endpoint probe, true when absent; close closes the endpoint", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    expect(await ch.isAvailable()).toBe(true);
    const down = new IrohRelayChannel({ endpoint: { ...ep, send: ep.send, onReceive: ep.onReceive, isAvailable: async () => false }, resolvePeer: resolve });
    expect(await down.isAvailable()).toBe(false);
    await ch.close();
    expect(ep.closed).toBe(true);
  });

  it("works as an 'iroh' rung: failing iroh falls through to lan_http", async () => {
    const ep = new FakeEndpoint();
    ep.failWith = new Error("relay down");
    const delivered: string[] = [];
    const lan: DeliveryChannel = { deliver: async (_d, w) => void delivered.push(w), onInbound: () => undefined };
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "iroh", channel: new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve }) },
        { name: "lan_http", channel: lan },
      ],
      budgets: { irohMs: 50 },
    });
    await ladder.deliver(PEER, "w");
    expect(delivered).toEqual(["w"]);
  });
});
