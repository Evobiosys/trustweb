// RelayClient — the browser-held self-sovereign identity's DIDComm relay
// client (QR-onboarding Task 3). A browser identity has no HTTP endpoint of
// its own (nothing can POST to it directly), so it can only send/receive via
// a trust-graph relay/mediator (packages/transport/src/relay_server.ts):
//   send()      — POST an already-packed wire to the relay's ingress.
//   onInbound() — drain an authenticated WebSocket for wires addressed to
//                 this identity's DID.
//
// REUSE DECISION: this ports packages/transport/src/relay_channel.ts's
// client-side protocol logic, NOT an import of it — same rationale as
// identity.ts/didcomm_crypto.ts's REUSE DECISIONs: relay_channel.ts imports
// `WebSocket` from `ws` (node-only) and its package pulls in `matrix-bot-sdk`
// transitively via the barrel. The wire-level PROTOCOL below (submit
// response shape, nonce -> Ed25519-sign -> auth handshake, wire/ack framing)
// is identical to relay_channel.ts's, so this client interoperates with the
// same live RelayServer transport's daemon talks to.
//
// WEBSOCKET API CHOICE: relay_channel.ts's DrainConnection is written against
// `ws`'s Node-EventEmitter API (`.on("message", data)`, `.terminate()`).
// That API does NOT exist on the browser's native WebSocket. This file is
// written against the DOM WebSocket interface instead
// (`addEventListener`/`close()`), which is the intersection both the native
// browser WebSocket AND `ws`'s WebSocket (v8+ implements addEventListener
// and delivers a MessageEvent-shaped `{data}`) support — so the exact same
// code drains a live relay whether run in a real browser (native
// `globalThis.WebSocket`) or under a Node test harness (an injected `ws`
// WebSocket via `wsCtor`).
//
// CRYPTO: send() calls this package's own didcomm_crypto.ts#packMessage
// (browser-safe port of transport's, see that file's header) to sign-then-
// encrypt the outgoing envelope; onInbound() calls its unpackMessage to
// decrypt-then-verify (signature + from-binding) every drained wire. The
// relay itself never decrypts anything — it only ever reads the outer `to`.
//
// AT-LEAST-ONCE: the relay may redeliver an unacked wire on reconnect (see
// relay_server.ts's file header). This client acks a wire's queue id right
// after handing it to the callback (success OR failure — a wire that fails
// to unpack is acked too, so a poisoned/malformed wire cannot wedge the
// queue and redeliver forever) but keeps NO local dedup of its own: a
// caller that needs duplicate-suppression must dedup on the delivered
// message's signed `id`, never by content (per the task brief).
import { v4 as uuidv4 } from "uuid";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { BrowserIdentity } from "./identity.js";
import { fromBase64url, toBase64url } from "./identity.js";
import { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
import { signSend } from "./relay_send_auth.js";

/** JWM `type` discriminator for envelopes sent over this client (mirrors transport's didcomm_transport.ts#ENVELOPE_TYPE). */
export const ENVELOPE_TYPE = "https://didcomm.org/resource-web/2.0/envelope";

/** WebSocket.OPEN, spelled out so we never reference a bare global `WebSocket` for the constant (it may not exist in a Node test environment). */
const WS_OPEN = 1;

/**
 * The minimal WebSocket surface this file needs — deliberately the
 * intersection of the DOM `WebSocket` and `ws`'s `WebSocket` (v8+), so both
 * are structurally assignable without any runtime shimming.
 */
export interface RelayWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Injectable WebSocket constructor — pass `ws`'s `WebSocket` under Node; browser callers can omit it and get `globalThis.WebSocket`. */
export type WebSocketCtor = new (url: string) => RelayWebSocketLike;

export interface BackoffOpts {
  /** Initial reconnect delay in ms. Defaults to 1000 (mirrors relay_channel.ts / apps/mobile-ui's live client). */
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

export interface RelayClientOptions {
  /** This browser identity — its DID, signing key (drain auth + pack), and key-agreement key (unpack). */
  identity: BrowserIdentity;
  /** The relay's HTTP base URL (e.g. "http://127.0.0.1:4000"). */
  relayUrl: string;
  /** Injectable WebSocket constructor. Defaults to `globalThis.WebSocket` (the real browser global). Node tests inject `ws`'s `WebSocket`. */
  wsCtor?: WebSocketCtor;
  /** Drain reconnect backoff (capped exponential). */
  reconnect?: BackoffOpts;
  /** Ingress HTTP path. Defaults to "/relay/send" (RelayServer.listen()'s default). */
  ingressPath?: string;
  /** Drain WS path. Defaults to "/relay/drain" (RelayServer's default). */
  drainPath?: string;
}

export interface RelayClient {
  /** Pack+encrypt `envelope` for `toDid` and submit it to the relay. Resolves once the relay accepts it (queued or live-flushed — indistinguishable, see relay_server.ts); throws on a `rejected` response or ingress failure. */
  send(toDid: string, envelope: unknown): Promise<void>;
  /** Register the callback invoked with `(fromDid, envelope)` for every drained, decrypted, verified inbound wire. Only one callback is kept — a later call replaces the earlier one. */
  onInbound(cb: (fromDid: string, envelope: unknown) => void): void;
  /** Opens the authenticated drain connection. Resolves once the connection either completes `auth_ok` or drops before doing so (never hangs forever) — reconnect keeps retrying in the background either way. */
  start(): Promise<void>;
  /** Closes the drain connection and stops reconnecting. Safe to call even if `start()` was never called. */
  stop(): void;
}

/** Wire shape validated loosely at the JSON layer, matching relay_server.ts's own ClientMessage convention. */
interface RelayFrame {
  type?: unknown;
  nonce?: unknown;
  id?: unknown;
  wire?: unknown;
  reason?: unknown;
}

function httpBaseToWsUrl(base: string, path: string): string {
  const u = new URL(path, base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** `setTimeout`'s return type differs between DOM (`number`) and Node (`NodeJS.Timeout`, which has `.unref()`); guard the call structurally so this compiles under either lib without assuming one. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Builds the browser relay client described in the QR-onboarding Task 3
 * brief. One instance talks to exactly one relay endpoint (unlike
 * transport's RelayChannel, which fans out to every configured relay a peer
 * might route through) — a browser identity advertises exactly one relay in
 * its did:peer:2 service block for the alpha, so a single-endpoint client is
 * the correct scope here.
 */
export function createRelayClient(opts: RelayClientOptions): RelayClient {
  const { identity, relayUrl } = opts;
  const wsCtor: WebSocketCtor | undefined = opts.wsCtor ?? (globalThis.WebSocket as unknown as WebSocketCtor | undefined);
  const ingressPath = opts.ingressPath ?? "/relay/send";
  const drainPath = opts.drainPath ?? "/relay/drain";
  const backoffOpts: ResolvedBackoff = {
    baseMs: opts.reconnect?.baseMs ?? DEFAULT_BACKOFF_BASE_MS,
    maxMs: opts.reconnect?.maxMs ?? DEFAULT_BACKOFF_MAX_MS,
  };

  let sink: ((fromDid: string, envelope: unknown) => void) | null = null;
  let ws: RelayWebSocketLike | null = null;
  let stopped = true;
  let backoff = backoffOpts.baseMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Pack+encrypt `envelope` for `toDid`, then POST the wire to the relay's
   * ingress. `routed !== "rejected"` is success — this deliberately mirrors
   * relay_channel.ts's submitOnce: the relay's accepted response no longer
   * distinguishes live vs queued delivery (presence-oracle fix), so "did the
   * relay accept it" is the only signal a caller gets or needs.
   */
  async function send(toDid: string, envelope: unknown): Promise<void> {
    const message: JwmMessage = {
      id: uuidv4(),
      type: ENVELOPE_TYPE,
      from: identity.did,
      to: [toDid],
      created_time: Date.now(),
      body: envelope,
    };
    const wire = packMessage({ sender: identity, recipientDid: toDid, message });

    const url = new URL(ingressPath, relayUrl).toString();
    const res = await fetch(url, { method: "POST", body: wire, headers: signSend(identity, wire) });
    const parsed = (await res.json().catch(() => ({}))) as { routed?: string; reason?: string };
    if (parsed.routed === "rejected") {
      throw new Error(`RelayClient.send: relay rejected wire for ${toDid}: ${parsed.reason ?? "no reason given"}`);
    }
    if (!res.ok) {
      throw new Error(`RelayClient.send: relay ingress ${url} responded ${res.status}`);
    }
  }

  function onInbound(cb: (fromDid: string, envelope: unknown) => void): void {
    sink = cb;
  }

  /**
   * Decrypt+verify one drained wire and hand it to the registered sink.
   * Never throws: a wire that fails to unpack (tamper, wrong recipient, bad
   * signature, from-binding mismatch) is dropped silently here — the caller
   * (open()'s message handler) acks it regardless, so a poisoned wire cannot
   * wedge the relay queue into redelivering it forever.
   */
  function handleWire(wire: string): void {
    let result: ReturnType<typeof unpackMessage>;
    try {
      result = unpackMessage({ recipient: identity, wire });
    } catch {
      return;
    }
    sink?.(result.from, result.message.body);
  }

  /**
   * Opens one drain connection and completes the nonce -> Ed25519-sign ->
   * auth_ok handshake relay_server.ts's handleAuth expects. Resolves as soon
   * as the connection either reaches `auth_ok` OR drops before doing so
   * (connection refused, immediate close, etc.) — so `start()` never hangs
   * forever even against an unreachable relay; reconnect keeps retrying
   * with capped backoff in the background regardless of how this particular
   * attempt resolved.
   */
  function open(): Promise<void> {
    return new Promise((resolve) => {
      if (stopped || !wsCtor) {
        resolve();
        return;
      }
      let socket: RelayWebSocketLike;
      try {
        socket = new wsCtor(httpBaseToWsUrl(relayUrl, drainPath));
      } catch {
        scheduleReconnect();
        resolve();
        return;
      }
      ws = socket;

      let settled = false;
      const resolveOnce = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.addEventListener("message", (event: { data: unknown }) => {
        let msg: RelayFrame;
        try {
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          msg = JSON.parse(raw) as RelayFrame;
        } catch {
          return; // ignore malformed frames (forward-compat / defensive)
        }

        if (msg.type === "challenge" && typeof msg.nonce === "string") {
          // Prove ownership of THIS identity's DID: sign the server-issued
          // nonce with our own Ed25519 signing key (relay_server.ts's 6b).
          const sig = ed25519.sign(fromBase64url(msg.nonce), identity.signingSecretKey);
          socket.send(JSON.stringify({ type: "auth", did: identity.did, sig: toBase64url(sig) }));
          return;
        }
        if (msg.type === "auth_ok") {
          backoff = backoffOpts.baseMs; // healthy again — reset the backoff
          resolveOnce();
          return;
        }
        if (msg.type === "auth_failed") {
          // Our own signature over our own claimed DID should always
          // verify; a failure here is a config/deployment mismatch, not a
          // transient fault. The server closes the socket on this outcome,
          // which fires "close" below and lets the standard backoff/
          // reconnect handle it.
          return;
        }
        if (msg.type === "wire" && typeof msg.id === "string" && typeof msg.wire === "string") {
          handleWire(msg.wire);
          // Ack the QUEUE frame id (msg.id), never the decrypted message's
          // own id — this is what tells the relay to dequeue this row.
          // Acking unconditionally (regardless of handleWire's success) is
          // what keeps a malformed/tampered wire from being redelivered
          // forever; at-least-once redelivery of a wire we never acked
          // (e.g. crash mid-handling) is by design (see file header).
          if (socket.readyState === WS_OPEN) {
            socket.send(JSON.stringify({ type: "ack", ids: [msg.id] }));
          }
          return;
        }
        // Unknown frame types ignored silently (forward-compat).
      });

      socket.addEventListener("close", () => {
        ws = null;
        resolveOnce(); // never hang start() forever on a connection that drops before auth_ok
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        // "close" always follows "error"; cleanup + reconnect live there.
      });
    });
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, backoffOpts.maxMs);
    const timer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, delay);
    unrefTimer(timer); // never keep a process alive solely for a relay drain retry
    reconnectTimer = timer;
  }

  async function start(): Promise<void> {
    if (!wsCtor) {
      throw new Error(
        "RelayClient.start: no WebSocket constructor available (pass wsCtor when running outside a browser)"
      );
    }
    stopped = false;
    backoff = backoffOpts.baseMs;
    await open();
  }

  function stop(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // already closing
      }
      ws = null;
    }
  }

  return { send, onInbound, start, stop };
}
