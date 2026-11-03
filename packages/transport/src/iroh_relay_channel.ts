// IrohRelayChannel — a DeliveryChannel rung that moves already-packed wires
// over an Iroh endpoint (https://www.iroh.computer): peers are addressed by
// node id (an Ed25519 public key), and iroh's relay servers carry the
// end-to-end-encrypted QUIC traffic when no direct path exists. Anyone can run
// an iroh relay, and a node can list several, so relays are interchangeable
// rather than one trusted mediator (see docs/IROH-RELAY.md).
//
// Failover: deliver() tries the candidate relays (the peer's advertised ones
// first, then our own, de-duplicated) one at a time, each attempt naming a
// single relay and bounded by attemptMs. An IrohRelaySelector puts relays that
// just failed into an exponential cooldown so they are tried last next time.
// At most maxRelayAttempts relays are tried per deliver; if all fail, one
// aggregated error is thrown so a LadderChannel falls through to its next
// rung. With no relay known at all, one direct-only attempt is made. Every
// attempt is reported through onAudit as a human-readable sentence (I6) that
// never carries wire bytes.
//
// Like every DeliveryChannel (delivery_channel.ts) this file only moves bytes:
// it never decrypts, verifies or dispatches. Inbound payloads go verbatim to
// the registered sink, which DidCommTransport wires to receiveInbound(), so the
// one unpack/dedup path stays the single one.
//
// The iroh runtime itself sits behind IrohEndpointLike and is injected, so
// this package takes no native dependency and tests run on a fake (I5).
import type { DeliveryChannel } from "./delivery_channel.js";
import { IrohRelaySelector } from "./iroh_relay_selector.js";

export interface IrohPeerAddr {
  /** Iroh node id of the peer (its Ed25519 public key, encoded as the iroh runtime expects). */
  nodeId: string;
  /** Relay servers the peer is reachable through, in preference order. */
  relayUrls?: string[];
  /** Direct socket addresses ("ip:port") the peer was last seen on; lets two nodes on one LAN connect with no relay at all. */
  directAddrs?: string[];
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
  /** Relay health tracker; pass one to share it across channels. Defaults to a private selector per channel. */
  selector?: IrohRelaySelector;
  /** Budget for one relay attempt; a timeout counts as that relay failing. Defaults to 10 s. */
  attemptMs?: number;
  /** Most relays tried per deliver(). Defaults to 3. */
  maxRelayAttempts?: number;
  /** Local audit sink (I6): one event per attempt and outcome. Never receives wire bytes. */
  onAudit?: (ev: IrohRelayAuditEvent) => void;
}

export interface IrohRelayAuditEvent {
  kind: "attempt" | "delivered" | "failed" | "gave_up";
  recipientDid: string;
  /** Relay used for this attempt; null = direct-only (no relay known). */
  relayUrl: string | null;
  /** 1-based attempt number; for gave_up, the number of attempts made. */
  attempt: number;
  ms?: number;
  error?: string;
  /** One human-readable sentence for the local decision log. */
  text: string;
}

export const DEFAULT_MAX_WIRE_BYTES = 1024 * 1024;
export const DEFAULT_ATTEMPT_MS = 10_000;
export const DEFAULT_MAX_RELAY_ATTEMPTS = 3;

/** Races `work` against `ms`; a timeout rejects. Guards the loser so a late rejection is never unhandled (as in ladder_channel.ts). */
async function withAttemptBudget(ms: number, work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  work.catch(() => undefined);
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class IrohRelayChannel implements DeliveryChannel {
  private readonly endpoint: IrohEndpointLike;
  private readonly resolvePeer: IrohRelayChannelOptions["resolvePeer"];
  private readonly relayUrls: string[];
  private readonly maxWireBytes: number;
  private readonly selector: IrohRelaySelector;
  private readonly attemptMs: number;
  private readonly maxRelayAttempts: number;
  private readonly onAudit?: (ev: IrohRelayAuditEvent) => void;

  constructor(opts: IrohRelayChannelOptions) {
    this.endpoint = opts.endpoint;
    this.resolvePeer = opts.resolvePeer;
    this.relayUrls = opts.relayUrls ?? [];
    this.maxWireBytes = opts.maxWireBytes ?? DEFAULT_MAX_WIRE_BYTES;
    this.selector = opts.selector ?? new IrohRelaySelector();
    this.attemptMs = opts.attemptMs ?? DEFAULT_ATTEMPT_MS;
    this.maxRelayAttempts = Math.max(1, opts.maxRelayAttempts ?? DEFAULT_MAX_RELAY_ATTEMPTS);
    this.onAudit = opts.onAudit;
  }

  private audit(ev: IrohRelayAuditEvent): void {
    try {
      this.onAudit?.(ev);
    } catch {
      // an audit sink must never change delivery behaviour
    }
  }

  async deliver(recipientDid: string, wire: string): Promise<void> {
    if (wire.length === 0) throw new Error("IrohRelayChannel.deliver: empty wire");
    const payload = new TextEncoder().encode(wire);
    if (payload.byteLength > this.maxWireBytes) {
      throw new Error(`IrohRelayChannel.deliver: wire of ${payload.byteLength} bytes exceeds ${this.maxWireBytes}`);
    }
    const peer = await this.resolvePeer(recipientDid);
    if (!peer) throw new Error(`IrohRelayChannel.deliver: no iroh address known for ${recipientDid}`);
    const candidates = this.selector.order([...(peer.relayUrls ?? []), ...this.relayUrls]);
    // No relay known at all: one direct-only attempt (null = direct).
    const plan: (string | null)[] = candidates.length > 0 ? candidates.slice(0, this.maxRelayAttempts) : [null];
    const errors: string[] = [];
    for (const [i, relayUrl] of plan.entries()) {
      const attempt = i + 1;
      const via = relayUrl ?? "a direct path";
      this.audit({ kind: "attempt", recipientDid, relayUrl, attempt, text: `Attempt ${attempt}: sending to ${recipientDid} via ${via}.` });
      const t0 = Date.now();
      try {
        const addr: IrohPeerAddr = { nodeId: peer.nodeId, relayUrls: relayUrl === null ? [] : [relayUrl], directAddrs: peer.directAddrs };
        await withAttemptBudget(this.attemptMs, this.endpoint.send(addr, payload));
      } catch (err) {
        const ms = Date.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        if (relayUrl !== null) this.selector.reportFailure(relayUrl);
        errors.push(`${relayUrl ?? "direct"}: ${msg}`);
        this.audit({ kind: "failed", recipientDid, relayUrl, attempt, ms, error: msg, text: `Attempt ${attempt} to ${recipientDid} via ${via} failed after ${ms} ms: ${msg}.` });
        continue;
      }
      const ms = Date.now() - t0;
      if (relayUrl !== null) this.selector.reportSuccess(relayUrl);
      this.audit({ kind: "delivered", recipientDid, relayUrl, attempt, ms, text: `Delivered to ${recipientDid} via ${via} on attempt ${attempt} in ${ms} ms.` });
      return;
    }
    this.audit({ kind: "gave_up", recipientDid, relayUrl: null, attempt: plan.length, text: `Gave up on ${recipientDid} after ${plan.length} failed iroh attempt(s); the ladder may try its next rung.` });
    throw new Error(
      `IrohRelayChannel.deliver: all ${plan.length} relay attempts failed for ${recipientDid} (${errors.join("; ")})`
    );
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
