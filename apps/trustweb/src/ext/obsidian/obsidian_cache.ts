// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: what this device remembers of a vault, in IndexedDB (its own database per record, like the images): the parsed notes
 * (path, hash and the facts of obsidian_parse.ts: a 280-character excerpt, e-mails, phone numbers; never the whole note text), the folder access
 * of the File System Access API, and the state of an unfinished ingestion run (the people and facts an AI found in the notes). Fails soft: without IndexedDB the cache lives as long as the page.
 */
import { obsidianDbName } from './obsidian_data'
import { memoryCache } from './obsidian_scan'
import type { NoteCache, NoteRecord } from './obsidian_scan'

const NOTES = 'notes'
const META = 'meta'

export interface VaultStore extends NoteCache {
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  /** Everything: notes, folder access, run state. */
  forget(): Promise<void>
}

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = (): void => resolve(r.result); r.onerror = (): void => reject(r.error) })
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = (): void => resolve(); tx.onerror = (): void => reject(tx.error); tx.onabort = (): void => reject(tx.error) })

const stores = new Map<string, VaultStore>()

/** One store (one connection) per record; another tab upgrading or deleting the database closes it, the next call opens a fresh one. */
export function openVaultStore(meId: string): VaultStore {
  let s = stores.get(meId)
  if (!s) stores.set(meId, s = create(meId))
  return s
}

function create(meId: string): VaultStore {
  if (typeof indexedDB === 'undefined') {
    const mem = memoryCache()
    const meta = new Map<string, unknown>()
    return { ...mem, getMeta: async <T>(k: string) => meta.get(k) as T | undefined, setMeta: async (k, v) => { meta.set(k, v) }, forget: async () => { await mem.clear(); meta.clear() } }
  }
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(obsidianDbName(meId), 1)
    r.onupgradeneeded = (): void => { r.result.createObjectStore(NOTES, { keyPath: 'path' }); r.result.createObjectStore(META) }
    r.onsuccess = (): void => { r.result.onversionchange = (): void => { r.result.close(); stores.delete(meId) }; resolve(r.result) }
    r.onerror = (): void => reject(r.error)
  })
  const run = async <T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => T): Promise<T> => {
    const tx = (await db).transaction(store, mode)
    const out = f(tx.objectStore(store))
    await done(tx)
    return out
  }
  return {
    all: async () => (await run(NOTES, 'readonly', (s) => req(s.getAll()))) as NoteRecord[],
    put: (rs) => run(NOTES, 'readwrite', (s) => { for (const r of rs) s.put(r) }),
    remove: (ps) => run(NOTES, 'readwrite', (s) => { for (const p of ps) s.delete(p) }),
    clear: () => run(NOTES, 'readwrite', (s) => { s.clear() }),
    getMeta: async <T>(k: string) => (await run(META, 'readonly', (s) => req(s.get(k)))) as T | undefined,
    setMeta: (k, v) => run(META, 'readwrite', (s) => { s.put(v, k) }),
    forget: async () => { await run(NOTES, 'readwrite', (s) => { s.clear() }); await run(META, 'readwrite', (s) => { s.clear() }) },
  }
}
