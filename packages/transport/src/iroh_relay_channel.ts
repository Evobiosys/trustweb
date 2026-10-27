// IrohRelayChannel — a DeliveryChannel rung that moves already-packed wires
// over an Iroh endpoint (https://www.iroh.computer): peers are addressed by
// node id (an Ed25519 public key), and iroh's relay servers carry the
// end-to-end-encrypted QUIC traffic when no direct path exists. Anyone can run
// an iroh relay, and a node can list several, so relays are interchangeable
// rather than one trusted mediator (see docs/IROH-RELAY.md).
//
// Like every DeliveryChannel (delivery_channel.ts) this file only moves bytes:
// it never decrypts, verifies or dispatches. Inbound payloads go verbatim to
// the registered sink, which DidCommTransport wires to receiveInbound(), so the
// one unpack/dedup path stays the single one.
//
// The iroh runtime itself sits behind IrohEndpointLike and is injected, so
// this package takes no native dependency and tests run on a fake (I5).
import type { DeliveryChannel } from "./delivery_channel.js";

export interface IrohPeerAddr {
  /** Iroh node id of the peer (its Ed25519 public key, encoded as the iroh runtime expects). */
  nodeId: string;
  /** Relay servers the peer is reachable through, in preference order. */
  relayUrls?: string[];
}

/** The minimal slice of an iroh endpoint this channel needs; the real binding implements it. */
export interface IrohEndpointLike {
  /** Send one datagram-sized payload to a peer; reject on failure. */
  send(addr: IrohPeerAddr, payload: Uint8Array): Promise<void>;
  /** Register the single receiver for inbound payloads. */
  onReceive(cb: (payload: Uint8Array) => void): void;
  isAvailable?(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface IrohRelayChannelOptions {
  endpoint: IrohEndpointLike;
  /** Map a recipient DID to its iroh address; undefined = no iroh route known. */
  resolvePeer: (did: string) => IrohPeerAddr | undefined | Promise<IrohPeerAddr | undefined>;
  /** Own fallback relays, tried after the peer's advertised ones. */
  relayUrls?: string[];
  /** Largest wire accepted for delivery. Defaults to 1 MiB. */
  maxWireBytes?: number;
}

export const DEFAULT_MAX_WIRE_BYTES = 1024 * 1024;

export class IrohRelayChannel implements DeliveryChannel {
  private readonly endpoint: IrohEndpointLike;
  private readonly resolvePeer: IrohRelayChannelOptions["resolvePeer"];
  private readonly relayUrls: string[];
  private readonly maxWireBytes: number;

  constructor(opts: IrohRelayChannelOptions) {
    this.endpoint = opts.endpoint;
    this.resolvePeer = opts.resolvePeer;
    this.relayUrls = opts.relayUrls ?? [];
    this.maxWireBytes = opts.maxWireBytes ?? DEFAULT_MAX_WIRE_BYTES;
  }

  async deliver(recipientDid: string, wire: string): Promise<void> {
    if (wire.length === 0) throw new Error("IrohRelayChannel.deliver: empty wire");
    const payload = new TextEncoder().encode(wire);
    if (payload.byteLength > this.maxWireBytes) {
      throw new Error(`IrohRelayChannel.deliver: wire of ${payload.byteLength} bytes exceeds ${this.maxWireBytes}`);
    }
    const peer = await this.resolvePeer(recipientDid);
    if (!peer) throw new Error(`IrohRelayChannel.deliver: no iroh address known for ${recipientDid}`);
    const relayUrls = [...new Set([...(peer.relayUrls ?? []), ...this.relayUrls])];
    await this.endpoint.send({ nodeId: peer.nodeId, relayUrls }, payload);
  }

  onInbound(cb: (wire: string) => void): void {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    this.endpoint.onReceive((payload) => {
      let wire: string;
      try {
        wire = decoder.decode(payload);
      } catch {
        return; // not a wire we could ever unpack; drop rather than wedge the endpoint
      }
      cb(wire);
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.endpoint.isAvailable ? this.endpoint.isAvailable() : true;
  }

  async close(): Promise<void> {
    await this.endpoint.close?.();
  }
}
