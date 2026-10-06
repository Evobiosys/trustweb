/**
 * Recordings kept on this phone (wave 1733, item 4b): the audio of a past
 * meeting or memo, so it can be played again from any line of its transcript
 * and from the moment an item was noted (the chain of proof).
 *
 * IndexedDB, not localStorage (a 1 h take at 32 kbit/s is about 14 MB). One
 * database per persona (and demo context), like store.ts's keys, so the
 * side-by-side demo's phones never see each other's audio. Capped: at most
 * MAX_RECORDINGS recordings and MAX_BYTES in all; when either is exceeded the
 * OLDEST audio is dropped first, its meeting and transcript stay. Deleting a
 * meeting deletes its audio. Audio is never part of a backup or of a meeting
 * sent inside TrustWeb (both carry AppState / the pack only, never this store).
 *
 * Everything here fails soft: a browser without IndexedDB (or private mode
 * refusing it) simply keeps no audio, and the play controls stay absent.
 */
import { clampAudioPlan } from './audio_plan'
import type { AudioEntry } from './audio_plan'

export { MAX_BYTES, MAX_RECORDINGS } from './audio_plan'

/** One take of a recording, with where it starts on the recording's timeline. */
export interface StoredTake {
  blob: Blob
  mimeType: string
  /** ms from the recording's start (the takes before it, end to end). */
  offsetMs: number
  durationMs: number
}

export interface StoredAudio {
  meetingId: string
  savedAt: number
  bytes: number
  takes: StoredTake[]
}

const STORE = 'audio'

function dbName(persona: string, context?: string): string {
  return `trustweb-audio.${persona}${context ? '.' + context : ''}`
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = (): void => resolve(r.result)
    r.onerror = (): void => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = (): void => resolve()
    tx.onerror = (): void => reject(tx.error)
    tx.onabort = (): void => reject(tx.error)
  })
}

/** The audio of this persona's past meetings. */
export class AudioStore {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly persona: string, private readonly context?: string) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
      const r = indexedDB.open(dbName(this.persona, this.context), 1)
      r.onupgradeneeded = (): void => { r.result.createObjectStore(STORE, { keyPath: 'meetingId' }) }
      r.onsuccess = (): void => resolve(r.result)
      r.onerror = (): void => reject(r.error)
    })
    this.db.catch(() => { this.db = null })
    return this.db
  }

  /** Keeps the takes of one meeting (replacing what was kept for it), then applies the caps. Returns the meetings whose audio was dropped. */
  async save(meetingId: string, takes: readonly StoredTake[], now: number = Date.now()): Promise<string[]> {
    if (!takes.length) return []
    const entry: StoredAudio = { meetingId, savedAt: now, bytes: takes.reduce((n, t) => n + t.blob.size, 0), takes: [...takes] }
    const db = await this.open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    await done(tx)
    return this.enforceCaps()
  }

  async load(meetingId: string): Promise<StoredAudio | null> {
    try {
      const db = await this.open()
      return (await request(db.transaction(STORE).objectStore(STORE).get(meetingId)) as StoredAudio | undefined) ?? null
    } catch {
      return null
    }
  }

  async has(meetingId: string): Promise<boolean> {
    try {
      const db = await this.open()
      return (await request(db.transaction(STORE).objectStore(STORE).count(meetingId))) > 0
    } catch {
      return false
    }
  }

  async remove(meetingId: string): Promise<void> {
    try {
      const db = await this.open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(meetingId)
      await done(tx)
    } catch { /* nothing kept */ }
  }

  /** What is kept, without loading any audio. */
  async entries(): Promise<AudioEntry[]> {
    try {
      const db = await this.open()
      const out: AudioEntry[] = []
      await new Promise<void>((resolve, reject) => {
        const c = db.transaction(STORE).objectStore(STORE).openCursor()
        c.onsuccess = (): void => {
          const cur = c.result
          if (!cur) { resolve(); return }
          const v = cur.value as StoredAudio
          out.push({ id: v.meetingId, savedAt: v.savedAt, bytes: v.bytes })
          cur.continue()
        }
        c.onerror = (): void => reject(c.error)
      })
      return out
    } catch {
      return []
    }
  }

  /** Drops the oldest audio until both caps hold; returns the meetings whose audio went. */
  async enforceCaps(): Promise<string[]> {
    const drop = clampAudioPlan(await this.entries())
    for (const id of drop) await this.remove(id)
    return drop
  }

  /** Reset this phone: every recording of this persona goes. */
  async clear(): Promise<void> {
    try {
      const db = await this.open()
      db.close()
    } catch { /* never opened */ }
    this.db = null
    if (typeof indexedDB !== 'undefined') await request(indexedDB.deleteDatabase(dbName(this.persona, this.context))).catch(() => undefined)
  }
}

/** Which take holds a moment of the recording, and where in that take. Past the end: the end of the last take. */
export function locate(takes: readonly Pick<StoredTake, 'offsetMs' | 'durationMs'>[], atMs: number): { take: number; withinMs: number } | null {
  if (!takes.length) return null
  const t = Math.max(0, atMs)
  for (let i = takes.length - 1; i >= 0; i--) {
    if (t >= takes[i].offsetMs) return { take: i, withinMs: Math.min(t - takes[i].offsetMs, takes[i].durationMs) }
  }
  return { take: 0, withinMs: 0 }
}
