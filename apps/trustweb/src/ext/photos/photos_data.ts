// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the module's slice of the record (`AppState.extData['photos']`), its check and its device-sync merge. Pure and small:
 * the always-loaded stub (index.ts) registers the merge; the pictures themselves are NOT here (they stay in this device's IndexedDB, photo_store.ts).
 * The slice holds the opt-in switch and the share bundles (a manifest of hashes, never a picture).
 */
import type { Scope } from '../../share_sink/share_lines'
import { isZone } from '../../share_sink/zones'

export const MODULE_ID = 'photos'

/** A share of photos: what was shared (ids and hashes on this device), with whom (the scope), and who that made (person ids at the time). */
export interface PhotoBundle {
  id: string
  photoIds: string[]
  hashes: string[]
  scope: Scope
  createdAt: number
  recipients: string[]
  /** 'stub': the manifest is sealed per recipient but nothing is sent yet (photo_share.ts). */
  transport: 'stub'
}

export interface PhotosData { faceMatch?: boolean; bundles?: PhotoBundle[] }

const isStr = (v: unknown): v is string => typeof v === 'string'
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isStr) ? (v as string[]) : null)

function parseBundle(v: unknown): PhotoBundle | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const sc = o.scope as Record<string, unknown> | undefined
  const photoIds = strs(o.photoIds), hashes = strs(o.hashes), recipients = strs(o.recipients)
  const include = strs(sc?.include), exclude = strs(sc?.exclude)
  if (!isStr(o.id) || !photoIds || !hashes || !recipients || !include || !exclude || !isStr(sc?.zone) || !isZone(sc.zone) || typeof o.createdAt !== 'number' || o.transport !== 'stub') return null
  return { id: o.id, photoIds, hashes, scope: { zone: sc.zone, include, exclude }, createdAt: o.createdAt, recipients, transport: 'stub' }
}

/** Every field checked (the slice rides the device sync like any setting); unknown fields dropped. */
export function parsePhotos(raw: unknown): PhotosData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: PhotosData = {}
  if (typeof o.faceMatch === 'boolean') d.faceMatch = o.faceMatch
  const bundles = Array.isArray(o.bundles) ? o.bundles.map(parseBundle).filter((b): b is PhotoBundle => b !== null) : []
  if (bundles.length) d.bundles = bundles
  return d
}

/** Two of my devices: bundles join by id (mine first); the switch is the incoming side's where it has one. */
export function mergePhotos(mineRaw: unknown, theirsRaw: unknown): PhotosData {
  const a = parsePhotos(mineRaw)
  const b = parsePhotos(theirsRaw)
  const out: PhotosData = { ...a, ...(b.faceMatch !== undefined ? { faceMatch: b.faceMatch } : {}) }
  const all = new Map([...(a.bundles ?? []), ...(b.bundles ?? [])].map((x) => [x.id, x]))
  if (all.size) out.bundles = [...all.values()]
  return out
}

/** One database per record on this device. */
export const photosDbName = (meId: string): string => `trustweb-photos.${meId}`

/** Reset this phone: the photo database goes with the rest (main.ts reset). Settles whatever IndexedDB does. */
export function clearPhotosDb(meId: string, idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB, timeoutMs = 3_000): Promise<void> {
  if (!idb) return Promise.resolve()
  const work = new Promise<void>((resolve) => {
    const r = idb.deleteDatabase(photosDbName(meId))
    r.onsuccess = r.onerror = r.onblocked = (): void => resolve()
  })
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}
