// iroh_relay_channel.test.ts — IrohRelayChannel against an in-memory fake of
// the IrohClient seam (no native iroh binding, no network). Wires are opaque
// synthetic strings: the channel never inspects them.
import { describe, it, expect } from "vitest";
import type { IrohClient, IrohPeerAddr } from "./iroh_relay_channel.js";
import { IrohRelayChannel } from "./iroh_relay_channel.js";

const PEER: IrohPeerAddr = { nodeId: "node-peer-1", relayUrls: ["https://relay.example.org/"] };
const DID = "did:peer:2.test-recipient";

class FakeIroh implements IrohClient {
  readonly sent: { peer: IrohPeerAddr; bytes: Uint8Array }[] = [];
  closed = false;
  behavior: "resolve" | "reject" | "hang" = "resolve";
  private sink: ((bytes: Uint8Array) => void) | undefined;

  async send(peer: IrohPeerAddr, bytes: Uint8Array): Promise<void> {
    this.sent.push({ peer, bytes });
    if (this.behavior === "reject") throw new Error("fake: dial failed");
    if (this.behavior === "hang") await new Promise<void>(() => {});
  }
  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.sink = cb;
  }
  fire(bytes: Uint8Array): void {
    this.sink?.(bytes);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);

function build(overrides: Partial<ConstructorParameters<typeof IrohRelayChannel>[0]> = {}) {
  const client = new FakeIroh();
  const channel = new IrohRelayChannel({
    client,
    resolvePeer: (did) => (did === DID ? PEER : undefined),
    ...overrides,
  });
  return { client, channel };
}

describe("IrohRelayChannel.deliver", () => {
  it("sends the wire verbatim (UTF-8) to the resolved peer", async () => {
    const { client, channel } = build();
    await channel.deliver(DID, "wire-abc");
    expect(client.sent.length).toBe(1);
    expect(client.sent[0]!.peer).toEqual(PEER);
    expect(text(client.sent[0]!.bytes)).toBe("wire-abc");
  });

  it("rejects without dialing when the peer has no iroh address", async () => {
    const { client, channel } = build();
    await expect(channel.deliver("did:peer:2.unknown", "w")).rejects.toThrow(/no iroh address/);
    expect(client.sent.length).toBe(0);
  });

  it("rejects when the client fails, so a ladder can advance", async () => {
    const { client, channel } = build();
    client.behavior = "reject";
    await expect(channel.deliver(DID, "w")).rejects.toThrow(/dial failed/);
  });

  it("rejects after sendTimeoutMs when the client hangs", async () => {
    const { client, channel } = build({ sendTimeoutMs: 20 });
    client.behavior = "hang";
    await expect(channel.deliver(DID, "w")).rejects.toThrow(/timed out/);
  });

  it("refuses wires above maxWireBytes without dialing", async () => {
    const { client, channel } = build({ maxWireBytes: 8 });
    await expect(channel.deliver(DID, "123456789")).rejects.toThrow(/too large/);
    expect(client.sent.length).toBe(0);
  });
});

describe("IrohRelayChannel.onInbound", () => {
  it("hands each inbound message to the sink as a verbatim string", () => {
    const { client, channel } = build();
    const seen: string[] = [];
    channel.onInbound((w) => seen.push(w));
    client.fire(new TextEncoder().encode("wire-in"));
    expect(seen).toEqual(["wire-in"]);
  });

  it("drops oversized inbound messages and keeps running", () => {
    const { client, channel } = build({ maxWireBytes: 4 });
    const seen: string[] = [];
    channel.onInbound((w) => seen.push(w));
    client.fire(new TextEncoder().encode("too-long"));
    client.fire(new TextEncoder().encode("ok"));
    expect(seen).toEqual(["ok"]);
  });

  it("does not let a throwing sink crash the client callback", () => {
    const { client, channel } = build();
    channel.onInbound(() => {
      throw new Error("sink boom");
    });
    client.fire(new TextEncoder().encode("x"));
  });
});

describe("IrohRelayChannel lifecycle", () => {
  it("isAvailable delegates to the client probe, defaulting to true", async () => {
    const { channel } = build();
    expect(await channel.isAvailable()).toBe(true);
    const probed = build();
    (probed.client as IrohClient).isAvailable = async () => false;
    expect(await probed.channel.isAvailable()).toBe(false);
  });

  it("close closes the client", async () => {
    const { client, channel } = build();
    await channel.close();
    expect(client.closed).toBe(true);
  });
});
