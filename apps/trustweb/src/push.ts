/**
 * Wave 11 (APK + notifications), the page side of Web Push: register the service worker (sw/sw.ts, served as sw.js), ask
 * the relay for its VAPID key, subscribe, and hand the subscription to the relay over the drain (net.ts setPush). Keeps the
 * worker's bundle (push_bundle.ts) current after every save, so the worker can read a waiting wire by itself.
 *
 * The relay's wake carries nothing; what a person is told, and whether, is decided on this device (notify_kinds.ts).
 * No service worker caching anywhere: the worker exists for push alone (vite.config.mjs says why).
 */
import type { PushSubscriptionJson } from './net'
import { kindsOf } from './notify_kinds'
import type { AppState } from './model'
import { clearPushBundle, writePushBundle } from './push_bundle'

export function pushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof PushManager !== 'undefined' && typeof Notification !== 'undefined'
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null
/** The relay's key the current subscription was made with (subscribePush), written into the worker's bundle. */
let relayKeyInUse: string | null = null

/** The one registration (scope: the app's base). Null where workers are not available or the file is not served (dev without the build). */
export function workerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null)
  if (!registering) {
    registering = navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((r) => r.update().then(() => r, () => r))
      .catch(() => null)
  }
  return registering
}

function toB64u(buf: ArrayBuffer | null): string | undefined {
  if (!buf) return undefined
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64u(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function asJson(sub: PushSubscription): PushSubscriptionJson {
  return { endpoint: sub.endpoint, keys: { p256dh: toB64u(sub.getKey('p256dh')), auth: toB64u(sub.getKey('auth')) } }
}

/** The relay's VAPID public key (GET /relay/push/key); null when this relay does not push (a preview, an old relay). */
async function relayKey(relayOrigin: string): Promise<string | null> {
  try {
    const res = await fetch(`${relayOrigin}/relay/push/key`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { publicKey?: unknown }
    return typeof body.publicKey === 'string' ? body.publicKey : null
  } catch {
    return null
  }
}

export type SubscribeOutcome = { ok: true; sub: PushSubscriptionJson } | { ok: false; why: 'unsupported' | 'no-worker' | 'relay-no-push' | 'denied' | 'failed' }

/**
 * Subscribes this device (or returns the subscription it already has). Permission is asked by the caller before (the
 * Settings button): here a missing grant is just reported.
 */
export async function subscribePush(relayOrigin: string): Promise<SubscribeOutcome> {
  if (!pushSupported()) return { ok: false, why: 'unsupported' }
  if (Notification.permission !== 'granted') return { ok: false, why: 'denied' }
  const reg = await workerRegistration()
  if (!reg) return { ok: false, why: 'no-worker' }
  const key = await relayKey(relayOrigin)
  if (!key) return { ok: false, why: 'relay-no-push' }
  try {
    let sub = await reg.pushManager.getSubscription()
    const keyBytes = fromB64u(key)
    const sameKey = sub?.options.applicationServerKey && toB64u(sub.options.applicationServerKey) === toB64u(keyBytes.buffer as ArrayBuffer)
    if (sub && !sameKey) { await sub.unsubscribe().catch(() => false); sub = null }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes as BufferSource })
    relayKeyInUse = key
    return { ok: true, sub: asJson(sub) }
  } catch {
    return { ok: false, why: 'failed' }
  }
}

/** Notifications off: no subscription on this device and no bundle for the worker. The relay is told by the caller (setPush(null)). */
export async function unsubscribePush(): Promise<void> {
  await clearPushBundle()
  if (!pushSupported()) return
  const reg = await workerRegistration()
  const sub = await reg?.pushManager.getSubscription().catch(() => null)
  await sub?.unsubscribe().catch(() => false)
}

/** What the worker needs, from the record as it is now. Peers without a DID (none in practice) are skipped. */
export function pushBundleOf(s: AppState, relayOrigin: string, appName: string): { identity: AppState['identity']; write: () => Promise<void> } {
  const identity = s.identity
  return {
    identity,
    write: () => (identity
      ? writePushBundle({ v: 1, identity, peers: s.peers.filter((p) => p.did).map((p) => ({ did: p.did, name: p.displayName })), kinds: kindsOf(s), relayOrigin, appName, ...(relayKeyInUse ? { vapidKey: relayKeyInUse } : {}) })
      : Promise.resolve()).catch(() => undefined),
  }
}

/**
 * A notification from the page while it is hidden. Android Chrome allows `new Notification` from a page no longer
 * (worker only), so the registration shows it when there is one; the constructor stays the fallback for desktop browsers.
 */
export async function showNotification(title: string, body: string): Promise<void> {
  const reg = pushSupported() ? await workerRegistration() : null
  if (reg) {
    try { await reg.showNotification(title, { body, tag: `trustweb-page-${Date.now()}`, renotify: true, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` }); return } catch { /* falls through */ }
  }
  try { new Notification(title, { body }) } catch { /* nothing more to try */ }
}
