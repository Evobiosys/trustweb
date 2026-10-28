// iroh_relay_channel.test.ts — IrohRelayChannel against an in-memory fake
// IrohEndpointLike. No network, no native module, no personal data: peers are
// synthetic ids ("node-a", "did:peer:test-…").
import { describe, it, expect } from "vitest";
import { IrohRelayChannel, type IrohEndpointLike, type IrohPeerAddr } from "./iroh_relay_channel.js";
import { LadderChannel } from "./ladder_channel.js";
import type { DeliveryChannel } from "./delivery_channel.js";

class FakeEndpoint implements IrohEndpointLike {
  sent: { addr: IrohPeerAddr; payload: Uint8Array }[] = [];
  cb: ((p: Uint8Array) => void) | null = null;
  closed = false;
  failWith: Error | null = null;
  async send(addr: IrohPeerAddr, payload: Uint8Array): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ addr, payload });
  }
  onReceive(cb: (p: Uint8Array) => void): void {
    this.cb = cb;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

const PEER = "did:peer:test-ben";
const resolve = (did: string): IrohPeerAddr | undefined =>
  did === PEER ? { nodeId: "node-b", relayUrls: ["https://relay.peer.example"] } : undefined;

describe("IrohRelayChannel", () => {
  it("delivers the wire verbatim as utf-8 bytes to the resolved node", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({ endpoint: ep, resolvePeer: resolve });
    await ch.deliver(PEER, '{"wire":"é"}');
    expect(ep.sent).toHaveLength(1);
    expect(ep.sent[0].addr.nodeId).toBe("node-b");
    expect(new TextDecoder().decode(ep.sent[0].payload)).toBe('{"wire":"é"}');
  });

  it("orders relay urls: peer's own first, then configured, no duplicates (interchangeable relays)", async () => {
    const ep = new FakeEndpoint();
    const ch = new IrohRelayChannel({
      endpoint: ep,
      resolvePeer: resolve,
      relayUrls: ["https://relay.one.example", "https://relay.peer.example"],
    });
    await ch.deliver(PEER, "w");
    expect(ep.sent[0].addr.relayUrls).toEqual(["https://relay.peer.example", "https://relay.one.example"]);
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
