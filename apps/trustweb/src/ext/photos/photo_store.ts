// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the photo store, IndexedDB on this device only (its own database, like image_store.ts). Two object stores: `meta`
 * (PhotoMeta, small, listed at once) and `blobs` (the kept picture and its 256 px thumbnail, read one by one). Never in the record, a
 * backup or a sync. The IDBFactory is passed in, so tests run on a fake. Fails soft: without IndexedDB nothing is kept.
 */
import { expired, type PhotoMeta } from './photo_model'

const META = 'meta'
const BLOBS = 'blobs'
export type Which = 'full' | 'thumb'
export interface NewPhoto { meta: PhotoMeta; full: Blob; thumb: Blob }
interface BlobRow { id: string; full: Blob; thumb: Blob }

const result = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = (): void => resolve(r.result); r.onerror = (): void => reject(r.error) })
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = (): void => resolve(); tx.onerror = (): void => reject(tx.error); tx.onabort = (): void => reject(tx.error) })

/** Bytes the store holds (pictures and thumbnails, tombstoned ones too). */
export const usageOf = (metas: readonly PhotoMeta[]): number => metas.reduce((n, m) => n + m.bytes + m.thumbBytes, 0)

export class PhotoStore {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly name: string, private readonly idb: IDBFactory | undefined) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (!this.idb) { reject(new Error('no IndexedDB')); return }
      const r = this.idb.open(this.name, 1)
      r.onupgradeneeded = (): void => {
        r.result.createObjectStore(META, { keyPath: 'id' })
        r.result.createObjectStore(BLOBS, { keyPath: 'id' })
      }
      r.onsuccess = (): void => {
        const db = r.result
        db.onversionchange = (): void => { db.close(); this.db = null }
        resolve(db)
      }
      r.onerror = (): void => reject(r.error)
    })
    this.db.catch(() => { this.db = null })
    return this.db
  }

  /** Keeps the picture, its thumbnail and its meta in one transaction. False when nothing could be kept. */
  async add(p: NewPhoto): Promise<boolean> {
    try {
      const tx = (await this.open()).transaction([META, BLOBS], 'readwrite')
      tx.objectStore(META).put(p.meta)
      tx.objectStore(BLOBS).put({ id: p.meta.id, full: p.full, thumb: p.thumb } satisfies BlobRow)
      await done(tx)
      return true
    } catch { return false }
  }

  async list(): Promise<PhotoMeta[]> {
    try { return await result((await this.open()).transaction(META).objectStore(META).getAll()) as PhotoMeta[] } catch { return [] }
  }

  async byHash(hash: string): Promise<PhotoMeta | null> {
    return (await this.list()).find((m) => m.hash === hash) ?? null
  }

  async blob(id: string, which: Which): Promise<Blob | null> {
    try {
      const row = await result((await this.open()).transaction(BLOBS).objectStore(BLOBS).get(id)) as BlobRow | undefined
      return row?.[which] ?? null
    } catch { return null }
  }

  /** Read, change, write one meta; the new meta, or null when the id is unknown or nothing could be written. */
  async update(id: string, change: (m: PhotoMeta) => PhotoMeta): Promise<PhotoMeta | null> {
    try {
      const store = (await this.open()).transaction(META, 'readwrite').objectStore(META)
      const m = await result(store.get(id)) as PhotoMeta | undefined
      if (!m) return null
      const next = change(m)
      await result(store.put(next))
      return next
    } catch { return null }
  }

  /** Drops the photos whose 30-day tombstone has run out; their ids. */
  async purgeExpired(now: number): Promise<string[]> {
    const gone = (await this.list()).filter((m) => expired(m, now)).map((m) => m.id)
    if (!gone.length) return []
    try {
      const tx = (await this.open()).transaction([META, BLOBS], 'readwrite')
      for (const id of gone) { tx.objectStore(META).delete(id); tx.objectStore(BLOBS).delete(id) }
      await done(tx)
      return gone
    } catch { return [] }
  }

  async clear(): Promise<void> {
    try {
      const tx = (await this.open()).transaction([META, BLOBS], 'readwrite')
      tx.objectStore(META).clear()
      tx.objectStore(BLOBS).clear()
      await done(tx)
    } catch { /* nothing kept */ }
  }
}
