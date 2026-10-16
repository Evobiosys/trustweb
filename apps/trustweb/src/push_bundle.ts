/**
 * Wave 11: what the service worker needs to read a waiting wire BY ITSELF after a push wake, kept in IndexedDB (the
 * only storage a worker and the page share; the app's record itself stays in localStorage, store.ts). The relay's wake
 * carries nothing, so the worker opens the drain with this identity, finds the sender among these connections, derives the
 * pair key and reads the envelope type: only then does it know whether this is a connect, an ask or a message, and whether
 * that kind is on. Same keys as the page holds, same origin, same device: nothing new leaves the phone.
 *
 * Written by push.ts after every save while notifications are on; cleared when they are turned off.
 */
import type { SerializedIdentityV1 } from '../../demo/src/did'
import type { NotifyKinds } from './model'

export interface PushBundle {
  v: 1
  identity: SerializedIdentityV1
  /** Connections by DID, with the name this device shows for them (the worker's notification names them). */
  peers: { did: string; name: string }[]
  kinds: NotifyKinds
  /** Where the drain is (location.origin of the app). */
  relayOrigin: string
  /** The app's name, the notification title. */
  appName: string
  /** The relay's VAPID public key (base64url), for re-subscribing from the worker (sw.ts onSubscriptionChange). Absent: older bundle. */
  vapidKey?: string
}

const DB_NAME = 'trustweb-push'
const STORE = 'bundle'
const KEY = 'me'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => { resolve(req.result); db.close() }
    req.onerror = () => { reject(req.error); db.close() }
  }))
}

export function writePushBundle(b: PushBundle): Promise<void> {
  return tx('readwrite', (s) => s.put(b, KEY)).then(() => undefined)
}

export function readPushBundle(): Promise<PushBundle | null> {
  return tx<unknown>('readonly', (s) => s.get(KEY)).then((v) => (v && (v as PushBundle).v === 1 ? (v as PushBundle) : null)).catch(() => null)
}

export function clearPushBundle(): Promise<void> {
  return tx('readwrite', (s) => s.delete(KEY)).then(() => undefined).catch(() => undefined)
}
