// IrohRelayChannel — a DeliveryChannel rung that moves already-packed DIDComm
// wires over an Iroh endpoint (QUIC, dial-by-NodeId, hole-punching with
// fallback through any iroh relay server — run by anyone). Design note:
// docs/IROH-RELAY.md.
//
// SCOPE: this file is only the seam. The real iroh binding (native/WASM) is
// supplied by the caller behind `IrohClient`; no iroh dependency is added
// here. Like every DeliveryChannel it never decrypts, verifies or dispatches:
// inbound wires go verbatim to the registered sink (DidCommTransport's
// receiveInbound), which stays the single dispatch path.
//
// NOT store-and-forward: an iroh relay forwards only to connected peers, so a
// deliver() to an offline peer rejects and the ladder advances to the queueing
// RelayChannel (questhub). The two coexist as separate rungs.
import type { DeliveryChannel } from "./delivery_channel.js";

/** Where to reach a peer: its iroh NodeId plus relay URL hints. */
export interface IrohPeerAddr {
  nodeId: string;
  relayUrls: string[];
}

/** Minimal surface of an iroh endpoint this channel needs. */
export interface IrohClient {
  /** Open (or reuse) a connection to `peer` and send one message. Rejects if the peer cannot be reached. */
  send(peer: IrohPeerAddr, bytes: Uint8Array): Promise<void>;
  /** Register the sink for inbound messages from any peer. */
  onMessage(cb: (bytes: Uint8Array) => void): void;
  isAvailable?(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface IrohRelayChannelOptions {
  client: IrohClient;
  /** Map a recipient DID to its iroh address (e.g. from the meet-card). Undefined = peer has no iroh rung. */
  resolvePeer: (recipientDid: string) => IrohPeerAddr | undefined;
  /** Per-send budget in ms. Defaults to 5000. */
  sendTimeoutMs?: number;
  /** Largest wire accepted in either direction, in bytes. Defaults to 256 KiB. */
  maxWireBytes?: number;
}

const DEFAULT_SEND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WIRE_BYTES = 256 * 1024;

export class IrohRelayChannel implements DeliveryChannel {
  private readonly client: IrohClient;
  private readonly resolvePeer: IrohRelayChannelOptions["resolvePeer"];
  private readonly sendTimeoutMs: number;
  private readonly maxWireBytes: number;

  constructor(opts: IrohRelayChannelOptions) {
    this.client = opts.client;
    this.resolvePeer = opts.resolvePeer;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    this.maxWireBytes = opts.maxWireBytes ?? DEFAULT_MAX_WIRE_BYTES;
  }

  async deliver(recipientDid: string, wire: string): Promise<void> {
    const bytes = new TextEncoder().encode(wire);
    if (bytes.byteLength > this.maxWireBytes) {
      throw new Error(`IrohRelayChannel.deliver: wire too large (${bytes.byteLength} > ${this.maxWireBytes} bytes)`);
    }
    const peer = this.resolvePeer(recipientDid);
    if (!peer) {
      throw new Error(`IrohRelayChannel.deliver: no iroh address for ${recipientDid}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`IrohRelayChannel.deliver: timed out after ${this.sendTimeoutMs}ms`)),
        this.sendTimeoutMs
      );
      timer.unref?.();
    });
    const work = this.client.send(peer, bytes);
    work.catch(() => undefined); // loser-guard, as in ladder_channel.ts
    try {
      await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  onInbound(cb: (wire: string) => void): void {
    this.client.onMessage((bytes) => {
      if (bytes.byteLength > this.maxWireBytes) return; // drop, never throw into the client
      try {
        cb(new TextDecoder().decode(bytes));
      } catch {
        // a faulty sink must not take the endpoint down
      }
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client.isAvailable) return true;
    try {
      return await this.client.isAvailable();
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close?.();
  }
}
