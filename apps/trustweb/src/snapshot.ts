/**
 * Local snapshots of the whole record (wave 13, R2): one is taken before every device-sync merge, every "same person" merge and every
 * restore, so none of them can lose data. Pure + WebCrypto; the sheets are snapshot_view.ts.
 *
 * A snapshot is the record JSON in the backup.ts blob layout ([version][IV][AES-GCM], AAD = version + the id label SNAPSHOT_ID), under an
 * AES key derived from the owner's key text with its own HKDF label (backup.ts snapshotKey). The key text is the same kind as a backup
 * key: the one the server backup uses if there is one, else one made once on this device (`ensureKey`); the owner can replace it with a
 * passphrase or a TW1 key text (`rekey`). A key kept beside the data protects a snapshot file that left the device, not the device itself;
 * the owner's own passphrase is the stronger choice.
 *
 * The last SNAPSHOT_KEEP are kept in localStorage, oldest dropped. Meetings are stored without transcript, early packs and late link (large
 * and regenerable); a restore puts the ones this device still has back (`restoreRecord`).
 */
import { fromB64u, toB64u } from '../../demo/src/crypto'
import { newRandomKey, openBlob, parseKeyText, sealBlob, snapshotKey } from './backup'
import type { BackupKey } from './backup'
import type { AppState } from './model'
import { slimMeeting } from './sync_core'

/** The AAD id label of every snapshot; a server backup (AAD = its blob id) can never be opened as one, nor the reverse. */
export const SNAPSHOT_ID = 'trustweb-snapshot/v1'
export const SNAPSHOT_KEEP = 5

type Store = Pick<Storage, 'getItem' | 'setItem'>

export interface SnapshotMeta { at: number; bytes: number; reason: string }
/** What localStorage holds per snapshot: the sealed bytes as base64url. */
export interface StoredSnapshot extends SnapshotMeta { blob: string }

/** The kept snapshots, oldest first. Unreadable storage: none. */
export function readSnapshots(store: Store, storeKey: string): StoredSnapshot[] {
  try {
    const list: unknown = JSON.parse(store.getItem(storeKey) ?? '[]')
    return Array.isArray(list) ? list.filter((e): e is StoredSnapshot => typeof e?.blob === 'string' && typeof e.at === 'number') : []
  } catch { return [] }
}

/** The owner's snapshot key: the one set here, else the server backup's, else one made now and kept (`fresh`). */
export async function ensureKey(store: Store, keyName: string, backupKeyText: string | null): Promise<{ key: BackupKey; fresh: boolean }> {
  for (const text of [store.getItem(keyName), backupKeyText]) {
    if (!text) continue
    try { return { key: parseKeyText(text), fresh: false } } catch { /* damaged: the next source */ }
  }
  const key = await newRandomKey()
  store.setItem(keyName, key.text)
  return { key, fresh: true }
}

export async function sealSnapshot(key: BackupKey, s: AppState, reason: string, at: number): Promise<Uint8Array> {
  const record: AppState = { ...s, ...(s.meetings ? { meetings: s.meetings.map(slimMeeting) } : {}) }
  return sealBlob(await snapshotKey(key), SNAPSHOT_ID, at, { at, reason, record })
}

/** Throws when the key is wrong or the bytes are damaged. */
export async function openSnapshot(key: BackupKey, bytes: Uint8Array): Promise<{ at: number; reason: string; record: unknown }> {
  return await openBlob(await snapshotKey(key), SNAPSHOT_ID, bytes) as { at: number; reason: string; record: unknown }
}

/**
 * Seals and keeps one snapshot. `kept` is false only when storage is full even after dropping the oldest once: the caller goes on with
 * the merge anyway (never lose data to a full disk) and says so. `blob` is the sealed bytes either way (for a file).
 */
export async function takeSnapshot(key: BackupKey, s: AppState, reason: string, store: Store, storeKey: string, now: number): Promise<{ blob: Uint8Array; kept: boolean }> {
  const blob = await sealSnapshot(key, s, reason, now)
  const next = [...readSnapshots(store, storeKey), { at: now, bytes: blob.length, reason, blob: toB64u(blob) }].slice(-SNAPSHOT_KEEP)
  for (const list of next.length > 1 ? [next, next.slice(1)] : [next]) {
    try { store.setItem(storeKey, JSON.stringify(list)); return { blob, kept: true } } catch { /* full: drop the oldest, once */ }
  }
  return { blob, kept: false }
}

/** Seals every kept snapshot again under `to`. One that `from` cannot open stays as it was and is counted in `skipped`. */
export async function rekey(from: BackupKey, to: BackupKey, store: Store, storeKey: string): Promise<{ skipped: number }> {
  let skipped = 0
  const out: StoredSnapshot[] = []
  for (const e of readSnapshots(store, storeKey)) {
    try {
      const data = await openBlob(await snapshotKey(from), SNAPSHOT_ID, fromB64u(e.blob))
      const blob = await sealBlob(await snapshotKey(to), SNAPSHOT_ID, e.at, data)
      out.push({ ...e, bytes: blob.length, blob: toB64u(blob) })
    } catch { skipped++; out.push(e) }
  }
  store.setItem(storeKey, JSON.stringify(out))
  return { skipped }
}

/** A snapshot's record for use now: the transcripts, early packs and late links the snapshot left out come back from the live record. */
export function restoreRecord(snap: AppState, live: AppState | null): AppState {
  const now = new Map((live?.meetings ?? []).map((m) => [m.id, m]))
  if (!snap.meetings?.length || !now.size) return snap
  return { ...snap, meetings: snap.meetings.map((m) => { const l = now.get(m.id); return l && !m.transcript.length ? { ...m, transcript: l.transcript, outbox: l.outbox, late: l.late } : m }) }
}
