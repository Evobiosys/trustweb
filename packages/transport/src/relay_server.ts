// RelayServer — trust-graph relay/mediator: a store-and-forward node a
// daemon runs so it can relay opaque wire messages for its friends
// (core-transport-plan.md Task 6, §1 rule 6: "a trust-graph node you
// already trust, not a neutral third party").
//
// Two responsibilities, deliberately kept separate:
//
//   ingress (6a) — submit(rawWire): read ONLY the outer `to` field (the
//   cleartext routing envelope produced by didcomm_crypto.ts's
//   packMessage — {typ,alg,epk,nonce,ciphertext,to}) to decide where the
//   wire goes. The ciphertext is never touched, never decrypted, and the
//   wire is never parsed as a protocol Envelope — this relay cannot read
//   plaintext even if it wanted to.
//
//   egress (6b/6c) — an authenticated, long-lived WebSocket "drain": a
//   recipient MUST prove DID ownership (Ed25519-sign a server-issued,
//   single-use nonce with the DID's did:peer:2 signing key) before any
//   queued wire is streamed to them. A signature that doesn't verify
//   against the CLAIMED did's key is rejected outright — the socket is
//   closed, nothing is queued or leaked, and the relay never associates
//   that connection with any DID's queue.
//
// Design note on "forward immediately, else enqueue" (6a's requirement):
// this implementation ALWAYS persists first (queueStore.enqueue), then
// immediately flushes to a live authenticated drain if one exists. Rows
// are removed from the queue store ONLY on an explicit ack from the
// recipient (ackDelivered) — never on drain, never on send. This makes
// 6c's "re-enqueue unacked wires on disconnect" free: a wire pushed to a
// socket that dies before acking was never actually dequeued, so the next
// authenticated drain (reconnect) redelivers it. At-least-once delivery;
// DidCommTransport's message-id dedup (dedup_store.ts / Task 2) absorbs
// any resulting duplicate deliveries on the receiving side.
//
// Servable-recipient policy: `isRoutable` decides whether this relay will
// hold mail for a given DID at all (default: permissive — accepts any
// DID). A relay that restricts this to its known trust-graph friends will
// synchronously reject an unroutable `to` from submit(), so a caller (the
// future RelayChannel / Task 7) can fall back to the next ladder rung
// instead of silently trusting store-and-forward to a relay with nothing
// to route.
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { resolveDidPeer } from "./did_identity.js";
import { InMemoryRelayQueueStore, MAX_HOLD_HORIZON_MS, type RelayQueueStore } from "./relay_queue_store.js";
import type { PushSubscriptionStore } from "./push_store.js";
import { parsePushSubscription, sendWake, type PushSubscriptionJson, type VapidKeys, type WakeOutcome } from "./web_push.js";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

// Ingress result. DELIBERATELY non-informative on success: a single
// `{ routed: "accepted" }` crosses the wire back to an (unauthenticated)
// submitter whether the wire was delivered live to a connected recipient or
// queued for an offline one, and carries NO queue id or recipient DID.
//
// WHY (adversarial-review finding 1 — ingress presence/volume oracle): the
// former {routed:"live"|"queued", toDid, queueId} response let any submitter
// probe (a) whether a recipient DID currently has an authenticated drain
// online (a presence oracle) and (b) the relay's global monotonic throughput
// via queueId (a volume oracle). Both are metadata leaks a store-and-forward
// relay must not emit. `rejected` (with a reason) is retained ONLY because a
// RelayChannel caller needs it to fall back to the next ladder rung — it
// signals "this relay won't carry this wire", never presence/volume.
export type SubmitResult = { routed: "accepted" } | { routed: "rejected"; reason: string };

/** The single non-informative success returned once a wire is accepted (live-flushed or queued — indistinguishable to the submitter). */
const ACCEPTED: SubmitResult = { routed: "accepted" };

/**
 * How long an opened drain socket has to complete a valid `auth` before the
 * server closes it. DoS hardening: without this, a client that opens the WS
 * and receives the nonce challenge but never authenticates would hold the
 * connection, its ConnState, and the issued nonce open forever, letting an
 * attacker exhaust server memory/file descriptors with idle sockets.
 */
const AUTH_DEADLINE_MS = 5_000;

/**
 * Hard cap on a single accepted wire (raw bytes). DoS hardening: ingress is
 * unauthenticated store-and-forward (by design — see file header), so without
 * a cap anyone could push arbitrary amounts of data into this process.
 *
 * ENFORCED IN TWO PLACES (finding 2 — the cap was previously dead on the
 * shipped path): (1) `submit()` itself rejects an over-cap `rawWire` BEFORE
 * parsing or enqueue, so EVERY caller is protected — including the alpha's
 * real path, agent-daemon/src/api/server.ts's `POST /relay/send`, which calls
 * `submit()` directly rather than going through `listen()`; and (2)
 * `handleIngressRequest` (only used by the standalone `listen()` deployment)
 * additionally bounds the *streamed* body so an oversize request is rejected
 * mid-stream without ever being fully buffered. server.ts's `/relay/send`
 * bounds its own read the same way (its RELAY_MAX_BODY_BYTES == this value).
 *
 * 128 KiB comfortably exceeds any real didcomm_crypto.ts EncryptedWire
 * (Ed25519 keys, a nonce, and ciphertext for chat-sized payloads are all a
 * few KB at most) while still bounding worst-case memory per request.
 */
const MAX_WIRE_BYTES = 128 * 1024;

/**
 * Per-recipient queue-depth cap. Bounds queue-poisoning: an unauthenticated
 * submitter (or a flood of them) cannot grow one DID's held-mail queue without
 * limit — the (N+1)th undelivered wire for a DID already holding this many is
 * rejected (submit → "rejected"), never silently dropping already-queued mail.
 * 1000 undelivered wires for a single offline recipient is far beyond any
 * legitimate alpha backlog (a recipient reconnects and drains long before
 * that) while capping per-victim memory at ~1000 * MAX_WIRE_BYTES worst case.
 */
const MAX_QUEUE_PER_DID = 1000;

/**
 * Global queue cap across all recipients. Second-order bound: even spread
 * across many victim DIDs (each under MAX_QUEUE_PER_DID), total held mail is
 * capped so the relay's memory/disk cannot be exhausted. 100k wires bounds the
 * whole store at ~100k * MAX_WIRE_BYTES (~12 GiB worst case, far less in
 * practice) — a generous alpha ceiling that still refuses an unbounded flood.
 */
const MAX_QUEUE_GLOBAL = 100_000;

export interface RelayServerOptions {
  /** Persistence for undelivered wires. Defaults to an in-memory store (lost on restart — pass a SqliteRelayQueueStore for production use). */
  queueStore?: RelayQueueStore;
  /** Does this relay hold/route mail for `toDid`? Default: accept any DID (open relay). */
  isRoutable?: (toDid: string) => boolean;
  /** ws ping interval for detecting a dead authenticated drain connection. */
  heartbeatIntervalMs?: number;
  /** How long an opened drain socket has to complete a valid `auth` before it is closed. Defaults to AUTH_DEADLINE_MS. */
  authDeadlineMs?: number;
  /** Max accepted ingress HTTP body size in bytes. Defaults to MAX_WIRE_BYTES. */
  maxWireBytes?: number;
  /** Max undelivered wires held for any single recipient DID. Defaults to MAX_QUEUE_PER_DID. */
  maxQueuePerDid?: number;
  /** Max undelivered wires held across all recipients. Defaults to MAX_QUEUE_GLOBAL. */
  maxQueueGlobal?: number;
  /** Web Push wake-ups (wave 11). Absent: the relay never pushes, phones are reached by their open drain only. */
  push?: RelayPushOptions;
}

/**
 * Wave 11 (TrustWeb APK + notifications): the relay may WAKE a phone through Web Push when a wire waits for it and
 * no drain reads it. The wake carries nothing (web_push.ts); the phone's service worker opens the drain and reads the
 * wire under its own keys. A phone opts in by sending `{type:"push", subscription}` on its authenticated drain;
 * `subscription: null` opts out again.
 */
export interface RelayPushOptions {
  store: PushSubscriptionStore;
  vapid: VapidKeys;
  /** Injectable sender (tests). Defaults to web_push.ts sendWake over global fetch. */
  send?: (sub: PushSubscriptionJson, vapid: VapidKeys) => Promise<WakeOutcome>;
  /** A phone whose drain is open but did not ack a flushed wire within this long is woken anyway (a frozen background tab). */
  ackWaitMs?: number;
  /** At most one wake per DID within this window; later wires in the window ride on the first wake. */
  coalesceMs?: number;
}

const PUSH_ACK_WAIT_MS = 5_000;
const PUSH_COALESCE_MS = 20_000;
const PUSH_KEY_PATH = "/relay/push/key";

/** Per-WebSocket connection state. Never exported — internal bookkeeping only. */
interface ConnState {
  authenticated: boolean;
  did?: string;
  /** Single-use challenge; cleared after the first auth attempt (success or failure) so it can never be replayed. */
  nonce?: string;
  /** Queue ids already pushed on this socket, awaiting ack — avoids resending on every flush() while a delivery is in flight. */
  sentPending: Set<string>;
  isAlive: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  /** Closes this socket if a valid `auth` hasn't completed by the deadline. Cleared on successful auth and on disconnect. */
  authDeadlineTimer?: ReturnType<typeof setTimeout>;
}

/** Shape validated at the JSON layer only; body fields are never trusted before their specific check. */
interface ClientMessage {
  type?: unknown;
  did?: unknown;
  sig?: unknown;
  ids?: unknown;
  subscription?: unknown;
}

export class RelayServer {
  private readonly queueStore: RelayQueueStore;
  private readonly isRoutableCheck: (toDid: string) => boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly authDeadlineMs: number;
  private readonly maxWireBytes: number;
  private readonly maxQueuePerDid: number;
  private readonly maxQueueGlobal: number;
  private readonly push: RelayPushOptions | null;
  /** DID -> when its last wake went out (push coalescing). */
  private readonly lastWake = new Map<string, number>();
  /** DIDs with an ack check pending (a wire flushed to an open drain, waiting PUSH_ACK_WAIT_MS before waking). */
  private readonly ackChecks = new Set<string>();

  /** DID -> its single active authenticated drain socket (a fresh auth for the same DID replaces the prior one). */
  private readonly liveDrains = new Map<string, WebSocket>();
  private readonly connState = new WeakMap<WebSocket, ConnState>();

  private wss?: WebSocketServer;
  private ownedHttpServer?: HttpServer;

  constructor(opts: RelayServerOptions = {}) {
    this.queueStore = opts.queueStore ?? new InMemoryRelayQueueStore();
    this.isRoutableCheck = opts.isRoutable ?? (() => true);
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;
    this.authDeadlineMs = opts.authDeadlineMs ?? AUTH_DEADLINE_MS;
    this.maxWireBytes = opts.maxWireBytes ?? MAX_WIRE_BYTES;
    this.maxQueuePerDid = opts.maxQueuePerDid ?? MAX_QUEUE_PER_DID;
    this.maxQueueGlobal = opts.maxQueueGlobal ?? MAX_QUEUE_GLOBAL;
    this.push = opts.push ?? null;
  }

  /** The VAPID public key phones subscribe with; null when this relay does not push. */
  pushPublicKey(): string | null {
    return this.push?.vapid.publicKey ?? null;
  }

  // ---- 6a: ingress -------------------------------------------------------

  /**
   * Accept an opaque wire addressed to a DID. Reads ONLY the outer `to`
   * field via a plain JSON.parse of the wire's outer envelope — this is
   * the cleartext routing header didcomm_crypto.ts's EncryptedWire always
   * carries; the ciphertext payload is never touched. Never throws.
   *
   * VALIDATE-BEFORE-ENQUEUE (finding 1): the queue is grown ONLY after every
   * cheap check passes — size cap, JSON/`to` shape, routability, and the
   * queue-depth caps. A garbage, oversize, unroutable, or over-cap submit
   * therefore never injects a row into a victim's queue. Order matters: the
   * size cap runs first (before we even parse), then routing shape, then the
   * caps (after a prune, so aged-out rows don't count against the ceiling).
   *
   * A wire that IS accepted is enqueued and, if the recipient has a live
   * authenticated drain, immediately flushed to it. The RESPONSE is the same
   * non-informative `{ routed: "accepted" }` either way — the submitter never
   * learns whether delivery was live or queued (presence oracle) nor any queue
   * id (volume oracle). We still persist-then-flush on the live path (rather
   * than delivering without a queue row) to preserve the at-least-once /
   * non-destructive-drain guarantee: the live recipient's prompt ack removes
   * its row, but a crash between flush and ack redelivers on reconnect.
   */
  submit(rawWire: string): SubmitResult {
    // finding 2: bound the wire before touching it, so no caller can stream an
    // unbounded body into memory ahead of validation (server.ts's /relay/send
    // reaches submit() directly). Byte length, not string length — the cap is
    // on wire bytes.
    if (Buffer.byteLength(rawWire, "utf8") > this.maxWireBytes) {
      return { routed: "rejected", reason: `wire exceeds ${this.maxWireBytes} bytes` };
    }

    let to: string;
    try {
      const parsed = JSON.parse(rawWire) as { to?: unknown };
      if (typeof parsed.to !== "string" || parsed.to.length === 0) {
        return { routed: "rejected", reason: "malformed wire: outer 'to' is missing or not a string" };
      }
      to = parsed.to;
    } catch {
      return { routed: "rejected", reason: "malformed wire: not valid JSON" };
    }

    if (!this.isRoutableCheck(to)) {
      return { routed: "rejected", reason: `no route to ${to}` };
    }

    // finding 3: prune first so freshness-aged rows are not counted against the
    // caps, then refuse to grow the queue past the per-DID or global ceiling.
    // Rejecting (not dropping) preserves already-queued mail for the recipient.
    this.queueStore.prune(Date.now());
    if (this.queueStore.count(to) >= this.maxQueuePerDid) {
      return { routed: "rejected", reason: "recipient queue is full" };
    }
    if (this.queueStore.total() >= this.maxQueueGlobal) {
      // TrustWeb review 6h: with a long hold (RELAY_QUEUE_HOLD_MS), wires for recipients that never come back (a reset phone, a demo
      // persona) would fill the relay for good, and an unauthenticated flood would shut it for everyone, for good. Under that pressure
      // the wires older than the shared horizon go first, as they always did before the long hold; recent mail is never dropped.
      this.queueStore.prune(Date.now(), MAX_HOLD_HORIZON_MS);
      if (this.queueStore.total() >= this.maxQueueGlobal) {
        return { routed: "rejected", reason: "relay queue is full" };
      }
    }

    this.queueStore.enqueue(to, rawWire);

    const live = this.liveDrains.get(to);
    if (live && live.readyState === WebSocket.OPEN) {
      this.flush(to);
      this.wakeIfUnacked(to);
    } else {
      void this.wake(to);
    }
    return ACCEPTED;
  }

  // ---- wave 11: push wake-ups --------------------------------------------

  /** A drain is open but may belong to a frozen tab: wake the phone if the queue still holds something after a short wait. */
  private wakeIfUnacked(toDid: string): void {
    if (!this.push || this.ackChecks.has(toDid)) return;
    this.ackChecks.add(toDid);
    const timer = setTimeout(() => {
      this.ackChecks.delete(toDid);
      if (this.queueStore.count(toDid) > 0) void this.wake(toDid);
    }, this.push.ackWaitMs ?? PUSH_ACK_WAIT_MS);
    timer.unref?.();
  }

  /** One contentless wake for `toDid`, at most once per coalescing window; a dead subscription is dropped. */
  private async wake(toDid: string): Promise<void> {
    const push = this.push;
    if (!push) return;
    const sub = push.store.get(toDid);
    if (!sub) return;
    const now = Date.now();
    const last = this.lastWake.get(toDid) ?? 0;
    if (now - last < (push.coalesceMs ?? PUSH_COALESCE_MS)) return;
    this.lastWake.set(toDid, now);
    const outcome = await (push.send ?? sendWake)(sub, push.vapid);
    if (outcome === "gone") push.store.remove(toDid);
    else if (outcome === "failed") this.lastWake.delete(toDid);
  }

  /** `{type:"push", subscription}` on an authenticated drain: keep (or, with null, forget) this DID's subscription. */
  private handlePush(ws: WebSocket, state: ConnState, msg: ClientMessage): void {
    if (!state.authenticated || !state.did) return;
    if (!this.push) {
      ws.send(JSON.stringify({ type: "push_unavailable" }));
      return;
    }
    if (msg.subscription === null) {
      this.push.store.remove(state.did);
      ws.send(JSON.stringify({ type: "push_ok", kept: false }));
      return;
    }
    const sub = parsePushSubscription(msg.subscription);
    if (!sub) {
      ws.send(JSON.stringify({ type: "push_rejected", reason: "malformed subscription" }));
      return;
    }
    this.push.store.set(state.did, sub);
    ws.send(JSON.stringify({ type: "push_ok", kept: true }));
  }

  /** Push every currently-queued, not-yet-sent-on-this-socket wire for `toDid` if it has a live authenticated drain. Idempotent. */
  private flush(toDid: string): void {
    const ws = this.liveDrains.get(toDid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const state = this.connState.get(ws);
    if (!state) return;
    this.queueStore.prune(Date.now());
    for (const q of this.queueStore.drain(toDid)) {
      if (state.sentPending.has(q.id)) continue; // already in flight on this socket
      state.sentPending.add(q.id);
      ws.send(JSON.stringify({ type: "wire", id: q.id, wire: q.wire }));
    }
  }

  // ---- 6b/6c: authenticated drain ----------------------------------------

  /**
   * Mount the drain WS endpoint onto an existing http.Server. Additive by
   * construction: `ws`'s `{server, path}` form hooks the HTTP "upgrade"
   * event for the given path only, which never competes with a server's
   * existing "request" listener (this is the same mechanism
   * agent-daemon/src/api/server.ts already uses for its own `/ws` mount).
   * Wiring this into the daemon's own server.ts as an extras.* hook is
   * Task 10's job (see relay_server.ts's file header / t6-report.md); this
   * method is what a future caller (Task 10, or `listen()` below) attaches.
   */
  attachDrainWss(httpServer: HttpServer, path = "/relay/drain"): void {
    const wss = new WebSocketServer({ server: httpServer, path });
    wss.on("connection", (ws) => this.handleConnection(ws));
    this.wss = wss;
  }

  private handleConnection(ws: WebSocket): void {
    const nonce = b64u(randomBytes(24));
    const state: ConnState = { authenticated: false, nonce, sentPending: new Set(), isAlive: true };
    this.connState.set(ws, state);
    ws.send(JSON.stringify({ type: "challenge", nonce }));

    // DoS hardening: a socket that opens, gets its challenge, and never
    // completes a valid `auth` must not hold the connection (and its
    // ConnState + nonce) open indefinitely. Cleared on successful auth
    // (handleAuth) and on disconnect (handleClose) — never double-fires.
    const authDeadlineTimer = setTimeout(() => {
      if (!state.authenticated) ws.terminate();
    }, this.authDeadlineMs);
    authDeadlineTimer.unref?.();
    state.authDeadlineTimer = authDeadlineTimer;

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return; // ignore malformed frames (forward-compat / defensive)
      }
      if (msg.type === "auth") this.handleAuth(ws, state, msg);
      else if (msg.type === "ack") this.handleAck(state, msg);
      else if (msg.type === "push") this.handlePush(ws, state, msg);
      // unknown types ignored silently, matching the JWM dispatch convention elsewhere in this package
    });
    ws.on("pong", () => {
      state.isAlive = true;
    });
    ws.on("close", () => this.handleClose(ws, state));
    ws.on("error", () => {
      // "close" always follows "error" for ws sockets; cleanup lives there.
    });
  }

  /**
   * Verify DID ownership: the client must return Ed25519.sign(nonce) using
   * the claimed DID's signing key. A signature that does not verify against
   * resolveDidPeer(did).signingPublicKey is REJECTED — no queue for `did`
   * is ever attached to this socket, so a spoofed claim cannot drain (or
   * even learn whether mail exists for) another peer's queue. The nonce is
   * single-use: cleared here regardless of outcome, so a failed guess
   * cannot be retried on the same challenge.
   */
  private handleAuth(ws: WebSocket, state: ConnState, msg: ClientMessage): void {
    if (state.authenticated) return; // already authenticated on this socket; ignore repeats
    const nonce = state.nonce;
    state.nonce = undefined;

    let verified = false;
    if (nonce && typeof msg.did === "string" && typeof msg.sig === "string") {
      try {
        const resolved = resolveDidPeer(msg.did);
        verified = ed25519.verify(unb64u(msg.sig), unb64u(nonce), resolved.signingPublicKey);
      } catch {
        verified = false; // malformed DID, bad base64, wrong-length signature, etc. — all reject
      }
    }

    if (!verified) {
      ws.send(JSON.stringify({ type: "auth_failed", reason: "signature does not verify for claimed DID" }));
      ws.close();
      return;
    }

    const did = msg.did as string;
    state.authenticated = true;
    state.did = did;
    if (state.authDeadlineTimer) {
      clearTimeout(state.authDeadlineTimer);
      state.authDeadlineTimer = undefined;
    }
    // One active drain per DID: a fresh, successfully-authenticated connection
    // for the same DID displaces the previous one rather than leaving two
    // sockets racing to drain (and double-deliver) the same queue.
    const prior = this.liveDrains.get(did);
    if (prior && prior !== ws) prior.close();
    this.liveDrains.set(did, ws);

    ws.send(JSON.stringify({ type: "auth_ok" }));
    this.startHeartbeat(ws, state);
    this.flush(did); // 6c: forward-on-connect
  }

  private handleAck(state: ConnState, msg: ClientMessage): void {
    if (!state.authenticated || !state.did || !Array.isArray(msg.ids)) return;
    const ids = msg.ids.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return;
    this.queueStore.ackDelivered(state.did, ids);
    for (const id of ids) state.sentPending.delete(id);
  }

  /** 6c liveness: ping on an interval, terminate a socket that never pongs back. */
  private startHeartbeat(ws: WebSocket, state: ConnState): void {
    const timer = setInterval(() => {
      if (!state.isAlive) {
        clearInterval(timer);
        ws.terminate();
        return;
      }
      state.isAlive = false;
      ws.ping();
    }, this.heartbeatIntervalMs);
    timer.unref?.(); // never keep a process alive solely for relay heartbeats
    state.heartbeatTimer = timer;
  }

  private handleClose(ws: WebSocket, state: ConnState): void {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.authDeadlineTimer) clearTimeout(state.authDeadlineTimer);
    if (state.authenticated && state.did && this.liveDrains.get(state.did) === ws) {
      this.liveDrains.delete(state.did);
    }
    // No explicit DB "re-enqueue" call needed here: rows this socket sent
    // but never acked were never removed from queueStore in the first
    // place (see the file header) — dropping state.sentPending is enough.
  }

  // ---- standalone convenience (used by relay_server.test.ts) ------------

  /**
   * Boots this relay as its own dedicated HTTP+WS server: POST {ingressPath}
   * with a raw wire body submits it; the drain WS is mounted at
   * {drainPath}. This is the "one node runs relay_server" deployment shape
   * (core-transport-plan.md Task 10) — a standalone process, not something
   * layered onto an unrelated daemon's request router (see attachDrainWss's
   * doc comment for why HTTP *route* mounting isn't safely additive onto an
   * arbitrary existing server the way the WS mount is).
   */
  async listen(port: number, host = "127.0.0.1", opts?: { ingressPath?: string; drainPath?: string }): Promise<{ port: number }> {
    const ingressPath = opts?.ingressPath ?? "/relay/send";
    const drainPath = opts?.drainPath ?? "/relay/drain";
    const httpServer = createHttpServer((req, res) => {
      void this.handleIngressRequest(req, res, ingressPath).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    });
    this.ownedHttpServer = httpServer;
    this.attachDrainWss(httpServer, drainPath);
    return new Promise((resolve, reject) => {
      httpServer.on("error", reject);
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        resolve({ port: typeof addr === "object" && addr ? addr.port : port });
      });
    });
  }

  private async handleIngressRequest(req: IncomingMessage, res: ServerResponse, ingressPath: string): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === PUSH_KEY_PATH) {
      const key = this.pushPublicKey();
      res.writeHead(key ? 200 : 404, { "content-type": "application/json", "cache-control": "no-cache" });
      res.end(JSON.stringify(key ? { publicKey: key } : { error: "this relay does not push" }));
      return;
    }
    if (req.method !== "POST" || url.pathname !== ingressPath) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `not found: ${req.method ?? ""} ${url.pathname}` }));
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      received += buf.length;
      if (received > this.maxWireBytes) {
        // DoS hardening: an unauthenticated submitter must not be able to
        // force unbounded buffering. Reject immediately — before anything is
        // parsed or enqueued — once the cap is exceeded. `Connection: close`
        // (rather than destroying the socket mid-read) lets the 413 response
        // flush cleanly, then drops the connection instead of trying to
        // resynchronize on whatever body bytes are still in flight.
        if (!res.headersSent) {
          res.writeHead(413, { "content-type": "application/json", connection: "close" });
          res.end(JSON.stringify({ error: `request body exceeds ${this.maxWireBytes} bytes` }));
        }
        req.destroy();
        return;
      }
      chunks.push(buf);
    }
    const rawWire = Buffer.concat(chunks).toString("utf8");

    const result = this.submit(rawWire);
    if (result.routed === "rejected") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  }

  async close(): Promise<void> {
    for (const ws of this.liveDrains.values()) ws.terminate();
    this.liveDrains.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => resolve());
    });
    if (this.ownedHttpServer) {
      const server = this.ownedHttpServer;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
