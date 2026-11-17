// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c sync-seamless (B1): where the Tana token lives. By default for this visit only (sessionStorage). With "Remember on this computer" it is also kept
 * sealed (AES-GCM) in localStorage, the key held in IndexedDB as a non-extractable CryptoKey. Best effort, said plainly: script running on this page can still
 * ask the browser to open it, so this protects the token from a copied profile folder, a backup or a storage dump, not from a cross-site-scripting bug.
 */
import { fromB64u, toB64u } from '../../demo/src/crypto'

export const TANA_SESSION_KEY = 'trustweb.tana.token'
export const TANA_LOCAL_KEY = 'trustweb.tana.token.sealed'
/** What an earlier build wrote: the token in plaintext. */
const LEGACY_KEY = 'trustweb.tana.token'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface TokenKeys { get(): Promise<CryptoKey | undefined>; put(k: CryptoKey): Promise<void> }
export interface TanaTokenDeps { session: Store; local: Store; keys: TokenKeys }

const frame = (iv: Uint8Array, ct: Uint8Array): string => toB64u(Uint8Array.of(...iv, ...ct))

export function createTanaToken(d: TanaTokenDeps) {
  const guard = <T>(f: () => T, fallback: T): T => { try { return f() } catch { return fallback } }
  async function key(make: boolean): Promise<CryptoKey | undefined> {
    const have = await d.keys.get()
    if (have || !make) return have
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await d.keys.put(k)
    return k
  }
  async function seal(token: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, (await key(true)) as CryptoKey, new TextEncoder().encode(token)))
    return frame(iv, ct)
  }
  async function unseal(sealed: string): Promise<string | null> {
    try {
      const k = await key(false)
      const all = fromB64u(sealed)
      if (!k || all.length < 13) return null
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, k, all.slice(12)))
    } catch { return null }
  }
  return {
    /** The token for this visit, else the remembered one (opened with the IndexedDB key). Nothing found: ''. */
    async load(): Promise<{ token: string; remembered: boolean }> {
      const now = guard(() => d.session.getItem(TANA_SESSION_KEY), null)
      const sealed = guard(() => d.local.getItem(TANA_LOCAL_KEY), null)
      const legacy = guard(() => d.local.getItem(LEGACY_KEY), null)
      if (legacy) {
        // An earlier build kept it in plaintext: it was kept on purpose then, so it moves into the sealed copy.
        await this.save(legacy, true)
        return { token: legacy, remembered: true }
      }
      if (now) return { token: now, remembered: sealed !== null }
      if (!sealed) return { token: '', remembered: false }
      const token = await unseal(sealed)
      if (token === null) { guard(() => d.local.removeItem(TANA_LOCAL_KEY), undefined); return { token: '', remembered: false } }
      guard(() => d.session.setItem(TANA_SESSION_KEY, token), undefined)
      return { token, remembered: true }
    },
    /** Keeps `token` for this visit; `remember` also seals it for the next ones (false removes that copy). An empty token clears both. */
    async save(token: string, remember: boolean): Promise<void> {
      guard(() => d.local.removeItem(LEGACY_KEY), undefined)
      if (!token) { guard(() => d.session.removeItem(TANA_SESSION_KEY), undefined); guard(() => d.local.removeItem(TANA_LOCAL_KEY), undefined); return }
      guard(() => d.session.setItem(TANA_SESSION_KEY, token), undefined)
      if (!remember) { guard(() => d.local.removeItem(TANA_LOCAL_KEY), undefined); return }
      try { d.local.setItem(TANA_LOCAL_KEY, await seal(token)) } catch { /* storage or IndexedDB blocked: this visit only */ }
    },
  }
}

/** The key store in IndexedDB (database `trustweb-tana`); a failing IndexedDB reads as "no key", so a remembered token is simply asked for again. */
function idbKeys(): TokenKeys {
  const open = (): Promise<IDBDatabase> => new Promise((res, rej) => {
    const r = indexedDB.open('trustweb-tana', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('k')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    return new Promise<T>((res, rej) => { const q = f(db.transaction('k', mode).objectStore('k')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
  }
  return { get: () => run('readonly', (s) => s.get('key') as IDBRequest<CryptoKey | undefined>).catch(() => undefined), put: async (k) => { await run('readwrite', (s) => s.put(k, 'key')) } }
}

let shared: ReturnType<typeof createTanaToken> | undefined
/** The one store of this page (browser storages). */
export const tanaTokenStore = (): ReturnType<typeof createTanaToken> => (shared ??= createTanaToken({ session: sessionStorage, local: localStorage, keys: idbKeys() }))
