// RelayChannel — the CLIENT side of the trust-graph relay/mediator server
// (core-transport-plan.md Task 7; counterpart to relay_server.ts's Task 6).
// This is rung "b" of the delivery ladder (see delivery_channel.ts's file
// header for the DeliveryChannel seam this implements).
//
// Two independent responsibilities, mirroring the server's ingress/drain
// split:
//
//   deliver(recipientDid, wire) — POST the already-packed wire (its outer
//   `to` field, set by didcomm_crypto.ts's packMessage, already carries the
//   recipient DID; `recipientDid` here is not re-embedded into the request,
//   it is the DeliveryChannel contract's parameter) to a known relay's
//   ingress endpoint (`POST {endpoint}/relay/send`, RelayServer's default
//   ingress path). The relay's `submit()` responds SYNCHRONOUSLY with a
//   SubmitResult ({routed: "accepted"|"rejected"} — deliberately collapsed so
//   the response leaks neither recipient presence nor relay volume; see
//   relay_server.ts finding 1) in the same HTTP response — that response IS
//   "the relay's delivery-ack" for this
//   protocol; there is no separate async ack a submitter waits on (the WS
//   `ack` frame is recipient -> relay, for queue dequeue, an unrelated
//   concept). `routed !== "rejected"` resolves; a 404/rejected response, a
//   request timeout, or an unreachable endpoint all count as that endpoint
//   failing, and the next configured endpoint is tried. Only once every
//   configured endpoint has failed does deliver() reject (so a LadderChannel
//   caller can fall back to the next rung, e.g. rung "c" LAN HTTP).
//
//   onInbound(cb) — open an authenticated, long-lived drain WebSocket to
//   EVERY configured relay endpoint (not just the first): a peer may route a
//   message through ANY relay this identity advertises in its own meet-card
//   (Task 8's CardPayload.relays), so missing even one configured endpoint's
//   drain would silently drop mail. Each endpoint's connection independently
//   completes the nonce -> Ed25519-signature -> auth_ok handshake (proving
//   ownership of THIS identity's DID, matching relay_server.ts's 6b), then
//   feeds every "wire" frame verbatim to the shared callback and immediately
//   acks its id. RelayChannel keeps no local dedup of its own: at-least-once
//   delivery is inherent to the server's ack-to-dequeue contract (a wire
//   pushed to a socket that dies before its ack lands is redelivered on the
//   next authenticated drain), and DidCommTransport's message-id dedup
//   (dedup_store.ts / Task 2) is the single place that absorbs any resulting
//   duplicate. What this file DOES guarantee is that it never gratuitously
//   re-emits an already-acked wire: acking happens right after handing the
//   wire to the callback, so a clean reconnect only re-drains whatever the
//   relay still has queued (i.e. whatever never got acked).
//
// Reconnect: each endpoint's drain connection reconnects independently with
// capped exponential backoff on any drop (mirrors
// apps/mobile-ui/src/api_client_live.js's reconnect: 1s -> 2s -> 4s -> ...
// -> 15s, reset to the base on a successful re-auth).
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Identity } from "./did_identity.js";
import type { DeliveryChannel } from "./delivery_channel.js";
import { signSend } from "./relay_send_auth.js";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export interface BackoffOpts {
  /** Initial reconnect delay in ms. Defaults to 1000 (mirrors api_client_live.js). */
  baseMs?: number;
  /** Ceiling the doubling backoff is capped at. Defaults to 15000. */
  maxMs?: number;
}

interface ResolvedBackoff {
  baseMs: number;
  maxMs: number;
}

const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 15_000;
/** How long deliver() waits for a single relay endpoint's ingress response before treating it as unreachable and trying the next configured endpoint. */
const DEFAULT_ACK_TIMEOUT_MS = 5_000;

export interface RelayChannelOptions {
  /** Known relay node HTTP base URLs (e.g. "http://127.0.0.1:4000"). deliver() tries these in order until one accepts; onInbound() drains ALL of them independently (see file header). Must not be empty. */
  relayEndpoints: string[];
  /** Drain reconnect backoff (capped exponential). */
  reconnect?: BackoffOpts;
  /** Per-endpoint timeout for deliver()'s ingress POST before moving to the next configured endpoint. */
  ackTimeoutMs?: number;
  /** Ingress HTTP path. Defaults to "/relay/send" (RelayServer.listen()'s default). */
  ingressPath?: string;
  /** Drain WS path. Defaults to "/relay/drain" (RelayServer's default). */
  drainPath?: string;
}

/** Wire shape validated loosely at the JSON layer, matching relay_server.ts's own ClientMessage convention. */
interface RelayFrame {
  type?: unknown;
  nonce?: unknown;
  id?: unknown;
  wire?: unknown;
  reason?: unknown;
}

function httpBaseToWsUrl(endpoint: string, path: string): string {
  const u = new URL(endpoint);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = path;
  return u.toString();
}

/**
 * One relay endpoint's persistent, authenticated drain connection. Not
 * exported — internal to RelayChannel, which owns one instance per
 * configured endpoint.
 */
class DrainConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly wsUrl: string,
    private readonly identity: Identity,
    private readonly onWire: (wire: string) => void,
    private readonly backoffOpts: ResolvedBackoff
  ) {
    this.backoff = backoffOpts.baseMs;
  }

  start(): void {
    this.open();
  }

  private open(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("message", (data) => {
      let msg: RelayFrame;
      try {
        msg = JSON.parse(data.toString()) as RelayFrame;
      } catch {
        return; // ignore malformed frames (forward-compat / defensive)
      }
      if (msg.type === "challenge" && typeof msg.nonce === "string") {
        // Prove ownership of THIS identity's DID: sign the server-issued
        // nonce with our own Ed25519 signing key (relay_server.ts's 6b).
        const sig = ed25519.sign(unb64u(msg.nonce), this.identity.signing.secretKey);
        ws.send(JSON.stringify({ type: "auth", did: this.identity.did, sig: b64u(sig) }));
        return;
      }
      if (msg.type === "auth_ok") {
        this.backoff = this.backoffOpts.baseMs; // healthy again — reset the backoff
        return;
      }
      if (msg.type === "auth_failed") {
        // Our own signature over our own claimed DID should always verify;
        // a failure here is a config/deployment mismatch, not a transient
        // fault. The server closes the socket on this outcome, which fires
        // "close" below and lets the standard backoff/reconnect handle it
        // rather than special-casing a hot retry loop here.
        return;
      }
      if (msg.type === "wire" && typeof msg.id === "string" && typeof msg.wire === "string") {
        this.onWire(msg.wire);
        // Ack immediately after handing off. onInbound's callback contract
        // is synchronous/fire-and-forget (DeliveryChannel's `(wire: string)
        // => void`), so there is no downstream "processed successfully"
        // signal to wait on; acking here is what keeps a clean reconnect
        // from gratuitously re-draining a wire we already dispatched (see
        // file header). At-least-once delivery — and the resulting
        // occasional duplicate on a crash-before-ack — is by design; Task 2's
        // dedup store is the single place that absorbs it.
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ack", ids: [msg.id] }));
        }
        return;
      }
      // Unknown frame types ignored silently (forward-compat).
    });

    ws.on("close", () => {
      this.ws = null;
      this.scheduleReconnect();
    });
    ws.on("error", () => {
      // "close" always follows "error" for ws sockets; cleanup + reconnect
      // live in the "close" handler.
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.backoffOpts.maxMs);
    const timer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    timer.unref?.(); // never keep a process alive solely for a relay drain retry
    this.reconnectTimer = timer;
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // already closing
      }
      this.ws = null;
    }
  }
}

export class RelayChannel implements DeliveryChannel {
  private readonly relayEndpoints: string[];
  private readonly ackTimeoutMs: number;
  private readonly ingressPath: string;
  private readonly drainPath: string;
  private readonly backoffOpts: ResolvedBackoff;
  private drains: DrainConnection[] = [];
  private sink: ((wire: string) => void) | null = null;

  constructor(private readonly identity: Identity, opts: RelayChannelOptions) {
    if (opts.relayEndpoints.length === 0) {
      throw new Error("RelayChannel: relayEndpoints must not be empty");
    }
    this.relayEndpoints = opts.relayEndpoints;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.ingressPath = opts.ingressPath ?? "/relay/send";
    this.drainPath = opts.drainPath ?? "/relay/drain";
    this.backoffOpts = {
      baseMs: opts.reconnect?.baseMs ?? DEFAULT_BACKOFF_BASE_MS,
      maxMs: opts.reconnect?.maxMs ?? DEFAULT_BACKOFF_MAX_MS,
    };
  }

  /**
   * POST the wire to a known relay's ingress; resolve as soon as one accepts
   * it (routed "accepted" — the mediator no longer discloses live vs queued),
   * reject only once every configured endpoint has failed (rejected / timed
   * out / unreachable) — see file header for why the synchronous ingress
   * response IS the delivery-ack.
   */
  async deliver(recipientDid: string, wire: string): Promise<void> {
    const errors: string[] = [];
    for (const endpoint of this.relayEndpoints) {
      try {
        const routed = await this.submitOnce(endpoint, wire);
        if (routed !== "rejected") return;
        errors.push(`${endpoint}: rejected (no route to ${recipientDid})`);
      } catch (err) {
        errors.push(`${endpoint}: ${(err as Error).message}`);
      }
    }
    throw new Error(
      `RelayChannel.deliver: no configured relay accepted a wire for ${recipientDid} (${errors.join("; ")})`
    );
  }

  private async submitOnce(endpoint: string, wire: string): Promise<"accepted" | "rejected"> {
    const url = new URL(this.ingressPath, endpoint).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.ackTimeoutMs);
    try {
      // Sender authentication (relay_send_auth.ts): a fresh signature per attempt, so each endpoint sees its own nonce.
      const res = await fetch(url, { method: "POST", body: wire, headers: signSend(this.identity, wire), signal: controller.signal });
      const body = (await res.json().catch(() => ({}))) as { routed?: string };
      // The mediator's success response is a single non-informative
      // `{ routed: "accepted" }` (relay_server.ts finding 1) — it deliberately
      // no longer distinguishes live vs queued, and deliver() only needs
      // "did any endpoint accept it?". Any non-"rejected", non-error response
      // counts as accepted (forward-compatible with the collapsed shape).
      if (res.status === 404 || body.routed === "rejected") return "rejected";
      if (!res.ok) throw new Error(`relay ingress ${url} responded ${res.status}`);
      return "accepted";
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Register the sink for inbound wires and open an authenticated drain
   * connection to every configured relay endpoint (see file header for why
   * ALL, not just the first). Each connection acks a wire's id right after
   * handing it to `cb`.
   */
  onInbound(cb: (wire: string) => void): void {
    this.sink = cb;
    this.drains = this.relayEndpoints.map((endpoint) => {
      const wsUrl = httpBaseToWsUrl(endpoint, this.drainPath);
      const conn = new DrainConnection(wsUrl, this.identity, (wire) => this.sink?.(wire), this.backoffOpts);
      conn.start();
      return conn;
    });
  }

  async close(): Promise<void> {
    for (const d of this.drains) d.close();
    this.drains = [];
  }
}
