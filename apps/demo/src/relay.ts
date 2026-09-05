/**
 * relay.ts -- the demo's network path.
 *
 * Two already-paired devices (Marlene, Nora -- see state.ts) exchange the
 * existing QueryEnvelope/AnswerEnvelope wire (wire.ts) through the LIVE
 * store-and-forward relay at questhub.eco
 * (packages/transport/src/relay_server.ts): `POST /relay/send` to submit,
 * `wss://.../relay/drain` to receive, Ed25519-authenticated by the did:peer:2
 * identity minted in did.ts.
 *
 * WHAT THIS PROVES, PRECISELY (read before reusing this claim anywhere):
 * the relay routes on the outer `to` field ONLY -- see relay_server.ts's file
 * header, "the ciphertext is never touched, never decrypted". The payload it
 * carries is AES-GCM ciphertext under the pair key the QR ceremony already
 * derived (crypto.ts#derivePairKey), which the relay never saw and cannot
 * derive. So: the relay learns who is talking to whom and when (traffic
 * metadata), and carries only ciphertext.
 *
 * WHAT THIS DOES **NOT** PROVE: `derivePairKey` is explicitly NOT an
 * authenticated key exchange (see crypto.ts's SECURITY NOTE) -- anyone who
 * saw both QR codes during the pairing ceremony can compute the same pair
 * key and therefore decrypt everything this module sends. This module's
 * job is carrying that already-established (and already-limited) trust
 * across a network hop without the relay operator being able to read it.
 * Do not describe any of this as secure end to end -- it is not an
 * authenticated channel, only an unreadable-to-the-relay one.
 *
 * CORS: the relay sends NO CORS headers on its ingress
 * (`POST /relay/send`), so that fetch() call only succeeds when this page
 * is served FROM the relay's own origin (questhub.eco in production) --
 * see resolveRelayOrigin() below. The `wss://.../relay/drain` WebSocket
 * handshake is NOT subject to CORS (the same-origin policy for XHR/fetch
 * does not apply to the WebSocket protocol), so the drain connection works
 * cross-origin regardless; only `send()`'s POST is origin-locked.
 *
 * SCOPE: `onEnvelope` accepts EITHER a single fixed `CryptoKey` (demos
 * 1/2/3/6's shape, unchanged: "a later call replaces the earlier one",
 * correct for a demo that pairs exactly one asker with one holder at a
 * time) OR a `PairKeyResolver` function that picks a key per inbound wire
 * from its cleartext `from` DID -- added for demo 20 (mode.ts's
 * `wotScenario() === 'geologengasse'`), where one laptop holds several
 * peers at once and each needs its OWN pair key to decrypt. Passing a plain
 * `CryptoKey` is exactly equivalent to passing `() => thatKey`: every
 * inbound wire is tried against it regardless of sender, byte-identically
 * to this file's behaviour before `PairKeyResolver` existed. `send()` takes
 * the pair key explicitly per call, as before -- it was never
 * single-peer-limited; only the receive side (`onEnvelope`'s single `sink`)
 * was.
 *
 * `sendRaw`/`onRawWire` are a second, DELIBERATELY UNENCRYPTED path,
 * scoped to exactly one caller: the one-scan connect-link ceremony's
 * bootstrap message (connect_link.ts), sent before either side can derive
 * a shared key at all. Nothing else in this app should ever call them --
 * see connect_link.ts's module header for why that one case is safe and
 * every other message stays on the encrypted `send`/`onEnvelope` path.
 */
import type { Identity } from './did'
import { signChallenge } from './did'
import type { Envelope } from './wire'
import { decodeFromQr, encodeForQr } from './wire'
import { fromB64u, open, randomBytes, seal, toB64u } from './crypto'

const DEFAULT_RELAY_ORIGIN = 'https://questhub.eco'
const DEFAULT_INGRESS_PATH = '/relay/send'
const DEFAULT_DRAIN_PATH = '/relay/drain'
const DEFAULT_RECONNECT_BASE_MS = 1_000
const DEFAULT_RECONNECT_MAX_MS = 15_000
/** How long the FIRST `connect()` call waits for `auth_ok` before rejecting. Only the initial call is time-boxed like this -- a live channel that later drops reconnects silently in the background for as long as the demo runs. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
/** WebCrypto/NIST-recommended AES-GCM IV length. */
const AES_GCM_IV_LEN = 12

// ---------------------------------------------------------------------------
// Encrypt/decrypt -- pure, no network. Exercised directly by relay.test.ts.
// ---------------------------------------------------------------------------

/**
 * AES-GCM-encrypts `envelope` under `pairKey` and returns
 * base64url(iv || ciphertext) -- the IV is fresh per call and PREPENDED to
 * the ciphertext (one field on the wire, per the handover brief), never
 * reused. Since 2026-09-05 (C-02/F-01) gate.ts's inner answer seal follows
 * the same rule: its `ivFromQid` scheme is gone, so no layer in this app
 * derives an AES-GCM nonce from anything but the CSPRNG.
 */
export async function encryptEnvelope(envelope: Envelope, pairKey: CryptoKey): Promise<string> {
  const iv = randomBytes(AES_GCM_IV_LEN)
  const plaintext = new TextEncoder().encode(encodeForQr(envelope))
  const ciphertext = await seal(pairKey, iv, plaintext)
  const framed = new Uint8Array(iv.length + ciphertext.length)
  framed.set(iv, 0)
  framed.set(ciphertext, iv.length)
  return toB64u(framed)
}

/**
 * Inverse of {@link encryptEnvelope}. Never throws: a payload that fails to
 * base64url-decode, is shorter than one IV, fails AEAD authentication, or
 * decodes to something `decodeFromQr` doesn't recognise as a QueryEnvelope /
 * AnswerEnvelope all produce `null` -- indistinguishable failure modes, on
 * purpose, mirroring `wire.ts#decodeFromQr` and `crypto.ts#open`'s own
 * "untrusted input, never throw" contracts. A `null` here means the caller
 * (onEnvelope's wire handler) must NOT ack -- see that function's comment.
 */
export async function decryptEnvelope(payloadB64u: string, pairKey: CryptoKey): Promise<Envelope | null> {
  let framed: Uint8Array
  try {
    framed = fromB64u(payloadB64u)
  } catch {
    return null
  }
  if (framed.length < AES_GCM_IV_LEN) return null
  const iv = framed.slice(0, AES_GCM_IV_LEN)
  const ciphertext = framed.slice(AES_GCM_IV_LEN)
  const plaintext = await open(pairKey, iv, ciphertext)
  if (!plaintext) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    return null
  }
  return decodeFromQr(text)
}

// ---------------------------------------------------------------------------
// Outer wire framing -- the JSON body POSTed to /relay/send and streamed
// back over the drain socket's `{type:"wire", wire}` frames. `to` is the
// ONLY field relay_server.ts's submit() reads (see its file header); `from`
// and `payload` cross the relay opaquely. Exercised directly by
// relay.test.ts.
// ---------------------------------------------------------------------------

export interface OuterWire {
  /** Recipient DID, cleartext -- the relay's sole routing key. */
  to: string
  /** Sender DID, cleartext. Not read by the relay; carried so a recipient
   *  can log/display who a wire is from before (or even without) decrypting
   *  it. No new leak: the two devices already exchanged DIDs during pairing,
   *  and `to` is cleartext on this same wire regardless. */
  from: string
  /** base64url(iv || AES-GCM ciphertext) -- see {@link encryptEnvelope}. */
  payload: string
}

export function buildOuterWire(toDid: string, fromDid: string, payloadB64u: string): string {
  const wire: OuterWire = { to: toDid, from: fromDid, payload: payloadB64u }
  return JSON.stringify(wire)
}

/** Never throws. Returns `null` for anything that isn't exactly `{to, from, payload}` of non-empty strings. */
export function parseOuterWire(raw: string): OuterWire | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (typeof o.to !== 'string' || o.to.length === 0) return null
  if (typeof o.from !== 'string' || o.from.length === 0) return null
  if (typeof o.payload !== 'string' || o.payload.length === 0) return null
  return { to: o.to, from: o.from, payload: o.payload }
}

// ---------------------------------------------------------------------------
// The channel
// ---------------------------------------------------------------------------

/**
 * The minimal WebSocket surface this file needs -- deliberately the
 * intersection of the DOM `WebSocket` and Node's native global `WebSocket`
 * (stable since Node 22; this repo requires Node >= 20, see root
 * package.json's `engines`), so both are structurally assignable without any
 * runtime shimming. Mirrors `packages/browser-agent/src/relay_client.ts`'s
 * identical seam, which exists for the same reason.
 */
export interface RelayWebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: any) => void): void // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type WebSocketCtor = new (url: string) => RelayWebSocketLike

const WS_OPEN = 1 // WebSocket.OPEN, spelled out so no code path needs a bare global `WebSocket` reference to read the constant.

/** Server frame shapes, validated loosely at the JSON layer (mirrors relay_server.ts's own `ClientMessage` convention on the other end). */
interface DrainFrame {
  type?: unknown
  nonce?: unknown
  id?: unknown
  wire?: unknown
  reason?: unknown
}

export type RelayStatus = 'connecting' | 'connected' | 'disconnected'

/**
 * Per-wire key lookup for `onEnvelope` (demo 20's multi-peer receive path --
 * see this file's module header). Called with the wire's cleartext sender
 * DID; returns the pair key to try, or `null`/`undefined` for "no known
 * peer, drop this wire" (same as a decrypt failure -- not acked, may be
 * redelivered). May be async since deriving an ECDH pair key touches
 * `crypto.subtle`.
 */
export type PairKeyResolver = (fromDid: string) => CryptoKey | null | undefined | Promise<CryptoKey | null | undefined>

export interface RelayChannelOptions {
  /** Overrides the resolved relay origin outright (highest priority -- see {@link resolveRelayOrigin}). Mainly for the e2e script and tests. */
  relayOrigin?: string
  ingressPath?: string
  drainPath?: string
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** How long the first `connect()` call waits for `auth_ok` before rejecting. */
  connectTimeoutMs?: number
  /** Injectable WebSocket constructor. Defaults to `globalThis.WebSocket`. */
  wsCtor?: WebSocketCtor
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

export interface RelayChannel {
  /**
   * Opens the authenticated drain connection for `identity` and completes
   * the nonce -> Ed25519-sign -> `auth_ok` handshake. Resolves once
   * `auth_ok` arrives; REJECTS if the server sends `auth_failed`, if the
   * socket closes before completing auth, or if `connectTimeoutMs` elapses
   * first. Either way, a capped-exponential-backoff reconnect loop keeps
   * running in the background (re-authenticating from scratch each
   * attempt) until `close()` is called -- so a caller whose first
   * `connect()` rejected because the relay was briefly unreachable does
   * not need to call `connect()` again; the channel keeps trying and
   * `onEnvelope`/`send` become live the moment a later attempt succeeds.
   * The REJECTION exists purely to give the FIRST caller fast, honest
   * feedback ("nothing is happening yet") rather than a promise that hangs
   * for the life of the retry loop.
   */
  connect(identity: Identity): Promise<void>
  /**
   * Encrypts `envelope` under `pairKey` and POSTs it to the relay's ingress
   * for `toDid`. Independent of drain state -- ingress is unauthenticated
   * store-and-forward (relay_server.ts's design), so this works even before
   * `connect()` succeeds, though `connect()` must have been called at least
   * once (to know this identity's own DID for the wire's `from` field).
   */
  send(toDid: string, envelope: Envelope, pairKey: CryptoKey): Promise<void>
  /**
   * Registers the callback for decrypted, validated inbound envelopes.
   * Every wire addressed to this identity's DID is decrypted with `pairKey`
   * and parsed with `decodeFromQr`; a wire that fails either step is
   * dropped and NOT acked (so the relay may redeliver it -- see
   * relay_server.ts's file header on at-least-once delivery).
   *
   * CALL THIS BEFORE `connect()`. A wire that arrives while no sink is
   * registered (`sink === null`) is also dropped-and-not-acked, exactly
   * like a decrypt failure -- but the "redeliver later" recovery only
   * actually happens on this SAME socket's `sentPending` set being empty
   * again, which requires a fresh reconnect (relay_server.ts's `flush`
   * skips ids already pushed on the live socket). A channel that connects
   * cleanly and stays connected may never reconnect, so a wire that lands
   * before `onEnvelope` is registered can be lost for the life of that
   * connection, not just delayed. Register the sink first.
   *
   * A wire that decrypts and parses is handed to `cb` and then acked. Only
   * one `(resolver, cb)` registration is kept -- a later call replaces the
   * earlier one. `pairKeyOrResolver` is either a fixed `CryptoKey` (tried
   * against every inbound wire regardless of sender -- demos 1/2/3/6's
   * exact original behaviour) or a `PairKeyResolver` that looks the key up
   * per wire by sender DID (demo 20's multi-peer case -- see the file
   * header).
   */
  onEnvelope(pairKeyOrResolver: CryptoKey | PairKeyResolver, cb: (envelope: Envelope, fromDid: string) => void): void
  /**
   * Sends `payload` to `toDid` WITHOUT encryption -- POSTs it to the relay
   * ingress verbatim, framed the same as `send()` (`buildOuterWire`), minus
   * the `encryptEnvelope` step.
   *
   * The ONE legitimate use of this, and the reason it exists at all: the
   * one-scan connect-link ceremony's bootstrap message (connect_link.ts),
   * where by construction NEITHER side can yet derive a shared key -- that
   * message is what tells the receiving side the sender's public key in the
   * first place. See connect_link.ts's module header for the full argument
   * for why this is still honest: the relay already sees `to`/`from` in
   * cleartext on every wire this file sends (this file's own header), and a
   * `connect-ack` payload carries nothing beyond a public did:peer:2 and a
   * display name -- no key material, nothing that would let the relay
   * decrypt anything it could not already decrypt. NEVER use this for
   * query/answer content or anything gated by consent -- those go through
   * `send()`, always encrypted.
   */
  sendRaw(toDid: string, payload: string): Promise<void>
  /**
   * Registers a callback that fires for the CLEARTEXT `from`/`payload` of
   * every drained wire, independent of -- and in addition to -- `onEnvelope`'s
   * decrypt-then-dispatch sink. Exists for the same one bootstrap case as
   * `sendRaw`: a caller cannot register a `pairKey` with `onEnvelope` for a
   * peer it does not know the public key of yet, so it has no other way to
   * observe "someone just told me who they are" arrive.
   *
   * Fires for EVERY wire, including ones `onEnvelope`'s sink also
   * successfully decrypts -- callers must apply their own filtering (e.g.
   * "only while a connect-link ceremony is pending") rather than assuming
   * this only ever fires for bootstrap wires. A wire is acked once EITHER
   * this callback reports it actually recognised the wire (returns `true`)
   * OR `onEnvelope` successfully decrypts it -- see `handleWire`'s
   * implementation. Only one registration is kept, matching `onEnvelope`'s
   * and `onStatus`'s single-registration convention.
   *
   * RETURN VALUE, root-caused 2026-09-05 (the residual ~1-in-8 "second
   * guest misses a broadcast query" loss, after the single-flight relay
   * channel fix closed the dominant cause): this callback USED to be typed
   * `=> void` and `handleWire` treated merely REGISTERING a raw sink --
   * `if (rawSink) { rawSink(...); handled = true }` -- as proof the wire
   * was handled, regardless of what the callback's own body actually did
   * with it. That was fine for its one intended case, the connect-link
   * bootstrap wire (`main.ts`'s `handleRawWire`), for exactly as long as it
   * only fired during a brief pairing window -- but `onRawWire` is
   * registered UNCONDITIONALLY for a channel's entire lifetime (every
   * relay-mode device does this once, in `bringUpRelayChannel`), so this
   * blanket "registered = handled" rule applied to EVERY wire the channel
   * ever received, ordinary encrypted queries and answers included --
   * `handleRawWire`'s own body recognises nothing but a `connect-ack` and
   * returns (does nothing) for anything else, so this was pure luck, not a
   * safety net, for every other wire type. The one case this mattered: a
   * wire whose `onEnvelope` decrypt genuinely fails on its FIRST delivery
   * attempt (an as-yet-unresolvable pair key being the likeliest cause --
   * see `pairKey`'s callers) is SUPPOSED to be left un-acked so the relay
   * redelivers it on the next authenticated drain (relay_server.ts's
   * at-least-once design, this file's own module header) -- but the old
   * "registered = handled" rule acked it anyway, on the strength of a raw
   * sink that never actually looked at it meaningfully, turning a
   * self-healing transient failure into a silent, permanent loss. The
   * callback now returns `true` only when it genuinely recognised and
   * processed this specific wire; anything else (`false` or `void`,
   * covering every pre-existing implementation that returned nothing) no
   * longer counts as handled on its own -- restoring the un-acked/redeliver
   * safety net for the one case it was ever supposed to cover.
   */
  onRawWire(cb: (fromDid: string, payload: string) => boolean | void): void
  /**
   * Registers a callback for connection status changes: `'connecting'` when
   * a drain attempt (first or a reconnect) starts, `'connected'` on
   * `auth_ok`, `'disconnected'` when the socket closes. `connect()`'s
   * returned Promise only ever tells a caller about the FIRST attempt (see
   * its doc comment) -- this is what a UI needs to reflect what actually
   * happens after that, including every silent-in-the-background reconnect.
   * Fires with `Date.now()` alongside the status so a caller can show "seit
   * HH:MM:SS" rather than a bare state name. Only one registration is kept,
   * matching `onEnvelope`'s convention.
   */
  onStatus(cb: (status: RelayStatus, at: number) => void): void
  /** Closes the drain connection and stops reconnecting. Safe to call even if `connect()` was never called. */
  close(): void
}

/**
 * Resolves the relay's HTTP(S) origin: an explicit `opts.relayOrigin` wins
 * outright; otherwise `VITE_RELAY_ORIGIN` (a build-time override for local
 * development); otherwise `location.origin` (correct in production: the
 * ingress POST is CORS-blocked from any other origin -- see the module
 * header -- so this page is already served FROM questhub.eco whenever
 * `send()` needs to work); otherwise the hardcoded default, for contexts
 * with no `location` (a Node script, a non-jsdom test).
 */
function resolveRelayOrigin(explicit?: string): string {
  if (explicit) return explicit
  // `import.meta.env` is a Vite-only construct: it is populated when this
  // module runs inside Vite (the dev server, the built bundle, or vitest,
  // which is Vite-powered) but is `undefined` when run directly under a
  // plain Node loader (e.g. tsx, as `test/e2e/relay_roundtrip.mjs` does) --
  // hence the optional chain rather than assuming `.env` always exists.
  const envOverride = import.meta.env?.VITE_RELAY_ORIGIN
  if (typeof envOverride === 'string' && envOverride.length > 0) return envOverride
  if (typeof location !== 'undefined' && location.origin) return location.origin
  return DEFAULT_RELAY_ORIGIN
}

function httpOriginToWsUrl(origin: string, path: string): string {
  const u = new URL(path, origin)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

/** `setTimeout`'s return type differs between DOM (`number`) and Node (`NodeJS.Timeout`, which has `.unref()`); guarded structurally so this compiles and runs correctly under either lib. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

export function createRelayChannel(opts: RelayChannelOptions = {}): RelayChannel {
  const relayOrigin = resolveRelayOrigin(opts.relayOrigin)
  const ingressPath = opts.ingressPath ?? DEFAULT_INGRESS_PATH
  const drainPath = opts.drainPath ?? DEFAULT_DRAIN_PATH
  const reconnectBaseMs = opts.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS
  const reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
  const connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const wsCtor: WebSocketCtor | undefined = opts.wsCtor ?? (globalThis.WebSocket as unknown as WebSocketCtor | undefined)
  const fetchImpl: typeof fetch | undefined = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis)

  let identity: Identity | null = null
  let ws: RelayWebSocketLike | null = null
  let stopped = true
  let backoff = reconnectBaseMs
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let sink: { resolveKey: PairKeyResolver; cb: (envelope: Envelope, fromDid: string) => void } | null = null
  let rawSink: ((fromDid: string, payload: string) => boolean | void) | null = null
  let statusCb: ((status: RelayStatus, at: number) => void) | null = null

  function emitStatus(status: RelayStatus): void {
    statusCb?.(status, Date.now())
  }

  /**
   * Decrypt+parse one drained wire and, only on success, hand it to the
   * registered sink and report "ack this id". See {@link RelayChannel}'s
   * `onEnvelope` doc for why a failure here must NOT ack -- UNLESS a raw
   * sink is registered AND reports it genuinely recognised this wire (see
   * `onRawWire`'s doc comment for why merely being REGISTERED no longer
   * counts -- that used to silently ack, and therefore permanently drop,
   * any ordinary encrypted wire whose decrypt happened to fail on its first
   * delivery attempt).
   */
  async function handleWire(rawWire: string): Promise<boolean> {
    const outer = parseOuterWire(rawWire)
    if (!outer) return false
    let handled = false
    if (rawSink) {
      const rawHandled = rawSink(outer.from, outer.payload)
      if (rawHandled) handled = true
    }
    if (sink) {
      const key = await sink.resolveKey(outer.from)
      if (key) {
        const envelope = await decryptEnvelope(outer.payload, key)
        if (envelope) {
          sink.cb(envelope, outer.from)
          handled = true
        }
      }
    }
    return handled
  }

  /**
   * Opens one drain connection and runs the nonce -> Ed25519-sign ->
   * `auth_ok` handshake relay_server.ts's `handleAuth` expects.
   * `onSettleFirstAttempt` (only passed for the very first connection) is
   * called exactly once with the outcome; every later reconnect passes
   * `undefined` and instead relies on `close` to schedule the next retry.
   */
  function openSocket(currentIdentity: Identity, onSettleFirstAttempt?: (err: Error | null) => void): void {
    if (stopped || !wsCtor) return
    let socket: RelayWebSocketLike
    try {
      socket = new wsCtor(httpOriginToWsUrl(relayOrigin, drainPath))
    } catch (err) {
      onSettleFirstAttempt?.(err instanceof Error ? err : new Error(String(err)))
      scheduleReconnect(currentIdentity)
      return
    }
    ws = socket

    let firstAttemptSettled = onSettleFirstAttempt === undefined
    const settleFirstAttempt = (err: Error | null): void => {
      if (firstAttemptSettled) return
      firstAttemptSettled = true
      onSettleFirstAttempt?.(err)
    }

    socket.addEventListener('message', (event: { data: unknown }) => {
      let msg: DrainFrame
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data)
        msg = JSON.parse(raw) as DrainFrame
      } catch {
        return // malformed frame -- ignore (forward-compat / defensive)
      }

      if (msg.type === 'challenge' && typeof msg.nonce === 'string') {
        const sig = signChallenge(currentIdentity, msg.nonce)
        socket.send(JSON.stringify({ type: 'auth', did: currentIdentity.did, sig }))
        return
      }
      if (msg.type === 'auth_ok') {
        backoff = reconnectBaseMs // healthy again -- reset the backoff
        emitStatus('connected')
        settleFirstAttempt(null)
        return
      }
      if (msg.type === 'auth_failed') {
        // Our own signature over our own claimed DID should always verify;
        // a failure here on the FIRST attempt means "stop, tell the
        // caller" -- see connect()'s contract. The server closes the
        // socket on this outcome, which fires "close" below; for a
        // reconnect (no pending promise) that just re-schedules the same
        // retry loop, matching relay_client.ts's precedent.
        const reason = typeof msg.reason === 'string' ? msg.reason : 'no reason given'
        settleFirstAttempt(new Error(`RelayChannel.connect: relay rejected auth: ${reason}`))
        return
      }
      if (msg.type === 'wire' && typeof msg.id === 'string' && typeof msg.wire === 'string') {
        const id = msg.id
        void handleWire(msg.wire).then((acked) => {
          if (acked && socket.readyState === WS_OPEN) {
            socket.send(JSON.stringify({ type: 'ack', ids: [id] }))
          }
        })
        return
      }
      // Unknown frame types ignored silently (forward-compat).
    })

    socket.addEventListener('close', () => {
      ws = null;
      emitStatus('disconnected')
      settleFirstAttempt(new Error('RelayChannel.connect: connection closed before authentication completed'))
      scheduleReconnect(currentIdentity)
    })
    socket.addEventListener('error', () => {
      // "close" always follows "error" for both DOM and Node WebSocket; cleanup + reconnect live there.
    })
  }

  function scheduleReconnect(currentIdentity: Identity): void {
    if (stopped || reconnectTimer) return
    const delay = backoff
    backoff = Math.min(backoff * 2, reconnectMaxMs)
    const timer = setTimeout(() => {
      reconnectTimer = null
      emitStatus('connecting')
      openSocket(currentIdentity)
    }, delay)
    unrefTimer(timer) // never keep a process alive solely for a relay drain retry
    reconnectTimer = timer
  }

  function connect(newIdentity: Identity): Promise<void> {
    if (!wsCtor) {
      return Promise.reject(
        new Error('RelayChannel.connect: no WebSocket constructor available (pass opts.wsCtor outside a browser/Node>=22 runtime)')
      )
    }
    identity = newIdentity
    stopped = false
    backoff = reconnectBaseMs
    emitStatus('connecting')

    return new Promise((resolve, reject) => {
      let settled = false
      const timeoutTimer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`RelayChannel.connect: no auth_ok within ${connectTimeoutMs}ms`))
        // Don't leave a slow-to-respond socket dangling: close it now. Its
        // own "close" handler still fires afterwards and schedules the
        // background reconnect loop (see connect()'s doc comment).
        try {
          ws?.close()
        } catch {
          // already closing
        }
      }, connectTimeoutMs)
      unrefTimer(timeoutTimer)

      openSocket(newIdentity, (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutTimer)
        if (err) reject(err)
        else resolve()
      })
    })
  }

  const INGRESS_TIMEOUT_MS = 15_000

  /** Shared by `send()` and `sendRaw()` -- everything except how `payload` was produced. */
  async function postToIngress(toDid: string, payload: string, callerLabel: string): Promise<void> {
    if (!identity) {
      throw new Error(`RelayChannel.${callerLabel}: connect() must be called at least once before ${callerLabel}()`)
    }
    if (!fetchImpl) {
      throw new Error(`RelayChannel.${callerLabel}: no fetch implementation available (pass opts.fetchImpl outside a browser/Node>=18 runtime)`)
    }
    const rawWire = buildOuterWire(toDid, identity.did, payload)

    const url = new URL(ingressPath, relayOrigin).toString()
    // A send that never settles is worse than a send that fails.
    //
    // Without this, a stalled connection left the promise pending forever:
    // nothing threw, nothing retried, and on the silent ambient path nothing
    // was on screen to notice. It cost a real bug -- the local query log,
    // which was written after this await, simply never got written on the
    // devices whose send happened to hang. That symptom is fixed elsewhere by
    // logging first, but the hang itself is a fault in its own right and it
    // also strands the ASKER, who waits out the full answer timeout for a
    // message that was never delivered.
    //
    // Fifteen seconds: far longer than the ~100 ms this normally takes, short
    // enough that a caller learns the truth while the person is still holding
    // the phone.
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ac ? setTimeout(() => ac.abort(), INGRESS_TIMEOUT_MS) : null
    let res: Response
    try {
      res = await fetchImpl(url, { method: 'POST', body: rawWire, ...(ac ? { signal: ac.signal } : {}) })
    } catch (err) {
      throw new Error(
        `RelayChannel.${callerLabel}: relay ingress ${url} did not answer within ` +
        `${INGRESS_TIMEOUT_MS} ms (${err instanceof Error ? err.message : String(err)})`,
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
    const parsed = (await res.json().catch(() => ({}))) as { routed?: string; reason?: string }
    if (parsed.routed === 'rejected') {
      throw new Error(`RelayChannel.${callerLabel}: relay rejected wire for ${toDid}: ${parsed.reason ?? 'no reason given'}`)
    }
    if (!res.ok) {
      throw new Error(`RelayChannel.${callerLabel}: relay ingress ${url} responded ${res.status}`)
    }
  }

  async function send(toDid: string, envelope: Envelope, pairKey: CryptoKey): Promise<void> {
    const payload = await encryptEnvelope(envelope, pairKey)
    await postToIngress(toDid, payload, 'send')
  }

  async function sendRaw(toDid: string, payload: string): Promise<void> {
    await postToIngress(toDid, payload, 'sendRaw')
  }

  function onEnvelope(pairKeyOrResolver: CryptoKey | PairKeyResolver, cb: (envelope: Envelope, fromDid: string) => void): void {
    const resolveKey: PairKeyResolver =
      typeof pairKeyOrResolver === 'function' ? pairKeyOrResolver : () => pairKeyOrResolver
    sink = { resolveKey, cb }
  }

  function onRawWire(cb: (fromDid: string, payload: string) => boolean | void): void {
    rawSink = cb
  }

  function onStatus(cb: (status: RelayStatus, at: number) => void): void {
    statusCb = cb
  }

  function close(): void {
    const wasActive = !stopped
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      // The socket's own 'close' listener fires from this (synchronously or
      // on the next tick, per runtime), and emits 'disconnected' there --
      // see that listener above. Nothing more to do in that branch.
      try {
        ws.close()
      } catch {
        // already closing
      }
      ws = null
    } else if (wasActive) {
      // No live socket (e.g. mid-backoff, waiting on reconnectTimer): no
      // 'close' event will ever fire for this call, so emit directly or a
      // status listener would be stuck on whatever it last saw.
      emitStatus('disconnected')
    }
  }

  return { connect, send, sendRaw, onEnvelope, onRawWire, onStatus, close }
}
