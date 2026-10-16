/**
 * Wave 11 (APK + notifications): TrustWeb's service worker, built by vite.config.mjs into sw.js at the app's root.
 * It exists for push alone: NO caching, NO fetch handler (the app had stale-cache trouble before; the live server already
 * sends no-cache for everything outside /assets/).
 *
 * The relay's wake (packages/transport/src/web_push.ts) carries nothing. This worker then does what the page would do:
 * opens the drain with the identity kept for it (push_bundle.ts), reads the waiting wires under the pair keys it can derive,
 * and tells the person only about the kinds they left on (notify_kinds.ts). It never acks a wire: the page reads them again
 * when it opens, as before. A visible page handles arrivals itself, so the worker stays quiet then.
 */
import { deserializeIdentity, ecdhSharedSecret, signChallenge } from '../../../demo/src/did'
import type { Identity } from '../../../demo/src/did'
import { deriveEcdhPairKey } from '../../../demo/src/crypto'
import { decryptEnvelope, parseOuterWire } from '../../../demo/src/relay'
import { decodeFromQr } from '../../../demo/src/wire'
import { kindOfWire, workerLines, NOTIFY_KINDS, WORKER_FALLBACK } from '../notify_kinds'
import type { NotifyKind } from '../notify_kinds'
import { readPushBundle } from '../push_bundle'
import type { PushBundle } from '../push_bundle'

/** The worker scope, typed here (tsconfig has the DOM lib, not WebWorker's; both at once clash). */
interface WindowClientLike { visibilityState?: string; focused?: boolean; focus(): Promise<unknown>; url: string }
interface ClientsLike { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClientLike[]>; openWindow(url: string): Promise<unknown>; claim(): Promise<void> }
interface ExtendableEventLike extends Event { waitUntil(p: Promise<unknown>): void }
interface NotificationEventLike extends ExtendableEventLike { notification: { close(): void } }
interface NotificationLike { tag: string; close(): void }
interface PushManagerLike { subscribe(o: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<PushSubscription>; getSubscription(): Promise<PushSubscription | null> }
interface RegistrationLike {
  showNotification(title: string, o: { body: string; tag: string; icon: string; renotify?: boolean; data?: unknown }): Promise<void>
  getNotifications(): Promise<NotificationLike[]>
  pushManager: PushManagerLike
}
interface SwScope {
  addEventListener(type: 'install' | 'activate' | 'push' | 'pushsubscriptionchange', cb: (e: ExtendableEventLike) => void): void
  addEventListener(type: 'notificationclick', cb: (e: NotificationEventLike) => void): void
  skipWaiting(): Promise<void>
  clients: ClientsLike
  registration: RegistrationLike
  location: { origin: string; pathname: string }
}
// Outside a worker (the unit test imports peekDrain) there is no `self` and nothing to listen for.
const sw = (typeof self !== 'undefined' ? self : globalThis) as unknown as SwScope

/** How long the relay may take to hand over what waits (a dozing radio is slow); then the worker tells what it has. */
const PEEK_TOTAL_MS = 15_000
/** An older relay sends no peek_end: no wire for this long after auth, everything that waited is in. */
const PEEK_QUIET_MS = 1_500

interface Arrival { kind: NotifyKind; name: string | null }

/**
 * Reads waiting wires with a PEEK auth (relay_server.ts): a read-only pass that never displaces the app's own drain, which
 * may be alive in the background, and acks nothing. Null: could not read (no answer in time, auth failed).
 */
export function peekDrain(bundle: PushBundle, identity: Identity, wsCtor: new (url: string) => WebSocket = WebSocket): Promise<Arrival[] | null> {
  return new Promise((resolve) => {
    const url = new URL('/relay/drain', bundle.relayOrigin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const names = new Map(bundle.peers.map((p) => [p.did, p.name]))
    const keys = new Map<string, Promise<CryptoKey>>()
    const pending: Promise<void>[] = []
    const arrivals: Arrival[] = []
    let authed = false
    let quiet: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket
    const finish = (ok: boolean): void => {
      clearTimeout(total)
      if (quiet) clearTimeout(quiet)
      try { ws.close() } catch { /* already closed */ }
      if (!ok) { resolve(null); return }
      void Promise.all(pending).then(() => resolve(arrivals))
    }
    const total = setTimeout(() => finish(authed), PEEK_TOTAL_MS)
    try { ws = new wsCtor(url.toString()) } catch { clearTimeout(total); resolve(null); return }
    const settle = (): void => { if (quiet) clearTimeout(quiet); quiet = setTimeout(() => finish(true), PEEK_QUIET_MS) }
    const read = async (raw: string): Promise<void> => {
      const outer = parseOuterWire(raw)
      if (!outer) return
      const name = names.get(outer.from) ?? null
      if (name !== null) {
        let key = keys.get(outer.from)
        if (!key) { key = deriveEcdhPairKey(ecdhSharedSecret(identity, outer.from)); keys.set(outer.from, key) }
        const env = await decryptEnvelope(outer.payload, await key).catch(() => null)
        if (env) { const kind = kindOfWire(env.t); if (kind) arrivals.push({ kind, name }); return }
      }
      // Not from a connection, or not under a pair key: the one unencrypted wire is a connect-ack (someone opened this phone's link).
      const env = decodeFromQr(outer.payload)
      if (env && env.t === 'connect-ack') arrivals.push({ kind: 'connect', name: env.from.displayName || null })
    }
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: { type?: unknown; nonce?: unknown; wire?: unknown }
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.type === 'challenge' && typeof msg.nonce === 'string') { ws.send(JSON.stringify({ type: 'auth', did: identity.did, sig: signChallenge(identity, msg.nonce), peek: true })); return }
      if (msg.type === 'auth_ok') { authed = true; settle(); return }
      if (msg.type === 'peek_end') { finish(true); return }
      if (msg.type === 'auth_failed') { finish(false); return }
      if (msg.type === 'wire' && typeof msg.wire === 'string') { pending.push(read(msg.wire)); settle() }
    })
    ws.addEventListener('close', () => finish(authed))
    ws.addEventListener('error', () => { /* close follows */ })
  })
}

async function visibleClient(): Promise<boolean> {
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return clients.some((c) => c.visibilityState === 'visible')
}

async function onPush(): Promise<void> {
  const bundle = await readPushBundle()
  if (!bundle) return // notifications are off on this device
  if (await visibleClient()) return // the page tells the person itself
  const anyOn = NOTIFY_KINDS.some((k) => bundle.kinds[k])
  if (!anyOn) return
  let identity: Identity | null = null
  try { identity = deserializeIdentity(bundle.identity) } catch { identity = null }
  const arrivals = identity ? await peekDrain(bundle, identity) : null
  let lines = arrivals ? workerLines(arrivals, bundle.kinds) : [WORKER_FALLBACK]
  const icon = new URL('icons/icon-192.png', bundle.relayOrigin + appBase()).toString()
  if (!lines.length) {
    // Nothing readable (the app in the background took it already, or every kind that arrived is off). A push that shows
    // nothing counts against this site in Chrome and the subscription gets throttled: show the fallback unless one of ours is up.
    const shown = await sw.registration.getNotifications().catch(() => [] as NotificationLike[])
    if (shown.some((n) => n.tag.startsWith('trustweb-'))) return
    lines = [WORKER_FALLBACK]
  }
  // One notification per arrival, each ringing on its own (Jakob 2026-10-16): a unique tag, never replacing an earlier one silently.
  const stamp = Date.now()
  await Promise.all(lines.map((body, i) => sw.registration.showNotification(bundle.appName, { body, tag: `trustweb-arrival-${stamp}-${i}`, renotify: true, icon })))
}

/**
 * The push service replaced this device's subscription (it happens after a browser update, a reinstall, a long sleep): the
 * relay still holds the old one and its wakes die. Subscribe again with the relay's key and hand the new one over on a peek
 * connection (handlePush accepts it there too), without waiting for the app to open.
 */
async function onSubscriptionChange(): Promise<void> {
  const bundle = await readPushBundle()
  if (!bundle?.vapidKey) return
  const keyBytes = Uint8Array.from(atob(bundle.vapidKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const sub = await sw.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes as BufferSource }).catch(() => null)
  if (!sub) return
  const b64 = (buf: ArrayBuffer | null): string | undefined => buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : undefined
  const json = { endpoint: sub.endpoint, keys: { p256dh: b64(sub.getKey('p256dh')), auth: b64(sub.getKey('auth')) } }
  let identity: Identity
  try { identity = deserializeIdentity(bundle.identity) } catch { return }
  await new Promise<void>((resolve) => {
    const url = new URL('/relay/drain', bundle.relayOrigin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws: WebSocket
    const done = (): void => { try { ws.close() } catch { /* closed */ } resolve() }
    const timer = setTimeout(done, PEEK_TOTAL_MS)
    try { ws = new WebSocket(url.toString()) } catch { clearTimeout(timer); resolve(); return }
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: { type?: unknown; nonce?: unknown }
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.type === 'challenge' && typeof msg.nonce === 'string') ws.send(JSON.stringify({ type: 'auth', did: identity.did, sig: signChallenge(identity, msg.nonce), peek: true }))
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ type: 'push', subscription: json }))
      else if (msg.type === 'push_ok' || msg.type === 'push_rejected' || msg.type === 'push_unavailable') { clearTimeout(timer); done() }
    })
    ws.addEventListener('close', () => { clearTimeout(timer); resolve() })
    ws.addEventListener('error', () => { /* close follows */ })
  })
}

/** The app's base path: the worker is served at <base>sw.js. */
function appBase(): string {
  return sw.location.pathname.replace(/sw\.js$/, '')
}

async function focusApp(): Promise<void> {
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const mine = clients.find((c) => c.url.startsWith(sw.location.origin + appBase()))
  if (mine) { await mine.focus(); return }
  await sw.clients.openWindow(sw.location.origin + appBase())
}

if ('registration' in sw && 'clients' in sw) {
  sw.addEventListener('install', () => { void sw.skipWaiting() })
  sw.addEventListener('activate', (e) => { e.waitUntil(sw.clients.claim()) })
  sw.addEventListener('push', (e) => { e.waitUntil(onPush()) })
  sw.addEventListener('pushsubscriptionchange', (e) => { e.waitUntil(onSubscriptionChange()) })
  sw.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(focusApp()) })
}
