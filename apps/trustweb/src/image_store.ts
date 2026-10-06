/**
 * Pictures a person attached to an inventory item (wave 1733 round B, item 1),
 * kept on this phone only: IndexedDB, its OWN database next to the audio one
 * (a new store in the audio database would need a version bump, and the
 * round-A build would then fail to open it). Never in the record, a backup,
 * an answer or a pack: the record holds the picture's id only.
 *
 * Capped: every picture is scaled down to at most MAX_SIDE pixels (JPEG),
 * at most MAX_IMAGES pictures and MAX_TOTAL_BYTES in all; past either, the
 * oldest picture goes first. Fails soft: without IndexedDB nothing is kept
 * and the item simply has no picture.
 */
import { clampAudioPlan } from './audio_plan'

export const MAX_SIDE = 1280
export const MAX_IMAGES = 60
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024
const JPEG_QUALITY = 0.82
const STORE = 'images'
export const CLEAR_TIMEOUT_MS = 3_000

export interface StoredImage {
  id: string
  savedAt: number
  bytes: number
  blob: Blob
}

function dbName(persona: string, context?: string): string {
  return `trustweb-images.${persona}${context ? '.' + context : ''}`
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = (): void => resolve(r.result)
    r.onerror = (): void => reject(r.error)
  })
}

/** Scales a picture down to MAX_SIDE (JPEG). A browser that cannot decode it keeps nothing. */
export async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', JPEG_QUALITY))
  } finally {
    bitmap.close()
  }
}

export class ImageStore {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly persona: string, private readonly context?: string) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
      const r = indexedDB.open(dbName(this.persona, this.context), 1)
      r.onupgradeneeded = (): void => { r.result.createObjectStore(STORE, { keyPath: 'id' }) }
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

  /** Keeps a picture (already shrunk) under `id`, then applies the caps. Returns the ids that went. */
  async put(id: string, blob: Blob, now: number = Date.now()): Promise<string[]> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ id, savedAt: now, bytes: blob.size, blob } satisfies StoredImage)
      tx.oncomplete = (): void => resolve()
      tx.onerror = (): void => reject(tx.error)
      tx.onabort = (): void => reject(tx.error)
    })
    const all = await this.list()
    const drop = clampAudioPlan(all.map((x) => ({ id: x.id, savedAt: x.savedAt, bytes: x.bytes })), MAX_IMAGES, MAX_TOTAL_BYTES)
    for (const gone of drop) await this.remove(gone)
    return drop
  }

  async get(id: string): Promise<Blob | null> {
    try {
      const db = await this.open()
      const v = await request(db.transaction(STORE).objectStore(STORE).get(id)) as StoredImage | undefined
      return v?.blob ?? null
    } catch {
      return null
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const db = await this.open()
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
    } catch { /* nothing kept */ }
  }

  private async list(): Promise<StoredImage[]> {
    try {
      const db = await this.open()
      return await request(db.transaction(STORE).objectStore(STORE).getAll()) as StoredImage[]
    } catch {
      return []
    }
  }

  /** Reset this phone: every picture goes; settles within the timeout whatever IndexedDB does. */
  async clear(timeoutMs: number = CLEAR_TIMEOUT_MS): Promise<void> {
    const pending = this.db
    this.db = null
    const work = (async (): Promise<void> => {
      if (pending) (await pending.catch(() => null))?.close()
      await request(indexedDB.deleteDatabase(dbName(this.persona, this.context)))
    })().catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) })])
    clearTimeout(timer)
  }
}
