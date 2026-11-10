// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: a chosen file becomes a kept picture (at most 1280 px) and a 256 px thumbnail. Both are re-encoded by the scaler, so the
 * camera's EXIF (place, time, device) never reaches the store; hasMetadata is the guard that proves it. The scaler, hash, clock and quota are passed
 * in (DOM and crypto live in photo_scale.ts / the view), so this runs on synthetic files in tests.
 */
import { FULL_SIDE, THUMB_SIDE, assignTo, restore, type PhotoMeta } from './photo_model'
import type { PhotoStore } from './photo_store'

export interface Scaled { blob: Blob; w: number; h: number }
export type Scaler = (file: Blob, side: number) => Promise<Scaled>

export interface IngestDeps {
  store: Pick<PhotoStore, 'add' | 'byHash' | 'update'>
  scale: Scaler
  hash: (bytes: Uint8Array) => Promise<string>
  newId: () => string
  now: () => number
  /** Is there room for this many more bytes (quotaRoom against the browser's estimate)? */
  room: (bytes: number) => Promise<boolean>
}

export type IngestResult =
  | { kind: 'added' | 'duplicate'; meta: PhotoMeta }
  | { kind: 'skipped'; why: 'not-image' | 'unreadable' | 'exif' | 'no-room' }

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i
export const isImageFile = (f: { type: string; name: string }): boolean => (f.type ? f.type.startsWith('image/') : IMAGE_EXT.test(f.name))

/** A JPEG APP1 segment tagged "Exif": the marker FF E1, a length, then the letters. */
export function hasExif(b: Uint8Array): boolean {
  for (let i = 0; i + 9 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return true
  }
  return false
}

const PNG_META = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt'])
const tag4 = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0)
const u32 = (b: Uint8Array, at: number, le = false): number => (le
  ? (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)
  : ((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0

/**
 * Review wave 40: any metadata a stored picture could carry, whatever format the encoder fell back to: JPEG APP1 (Exif, XMP) and APP13 (IPTC)
 * segments, PNG eXIf/tEXt/iTXt/zTXt chunks, WebP EXIF/XMP chunks; plus the plain Exif byte scan.
 */
export function hasMetadata(b: Uint8Array): boolean {
  if (hasExif(b)) return true
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 3 < b.length && b[i] === 0xff;) {
      const m = b[i + 1] ?? 0
      if (m === 0xda || m === 0xd9) break   // image data follows: no more headers
      if (m === 0xe1 || m === 0xed) return true
      i += 2 + (((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))
    }
    return false
  }
  if (b[0] === 0x89 && tag4(b, 1) === 'PNG\r') {
    for (let i = 8; i + 8 <= b.length;) {
      if (PNG_META.has(tag4(b, i + 4))) return true
      i += 12 + u32(b, i)
    }
    return false
  }
  if (tag4(b, 0) === 'RIFF' && tag4(b, 8) === 'WEBP') {
    for (let i = 12; i + 8 <= b.length;) {
      const t = tag4(b, i)
      if (t === 'EXIF' || t === 'XMP ') return true
      const n = u32(b, i + 4, true)
      i += 8 + n + (n & 1)
    }
  }
  return false
}

const bytesOf = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer())

export async function ingestFile(file: File | (Blob & { name: string }), o: { source: string; people: string[] }, d: IngestDeps): Promise<IngestResult> {
  if (!isImageFile(file)) return { kind: 'skipped', why: 'not-image' }
  let full: Scaled, thumb: Scaled
  try {
    full = await d.scale(file, FULL_SIDE)
    thumb = await d.scale(full.blob, THUMB_SIDE)
  } catch { return { kind: 'skipped', why: 'unreadable' } }
  const bytes = await bytesOf(full.blob)
  if (hasMetadata(bytes) || hasMetadata(await bytesOf(thumb.blob))) return { kind: 'skipped', why: 'exif' }
  const hash = await d.hash(bytes)
  const same = await d.store.byHash(hash)
  if (same) {
    const meta = o.people.reduce(assignTo, same.deletedAt === undefined ? same : restore(same))   // review wave 40: picked again = back from Recently removed
    if (meta !== same) await d.store.update(same.id, () => meta)
    return { kind: 'duplicate', meta }
  }
  if (!(await d.room(full.blob.size + thumb.blob.size))) return { kind: 'skipped', why: 'no-room' }
  const meta: PhotoMeta = { id: d.newId(), source: o.source, addedAt: d.now(), bytes: full.blob.size, thumbBytes: thumb.blob.size, w: full.w, h: full.h, hash, people: [...new Set(o.people)] }
  return (await d.store.add({ meta, full: full.blob, thumb: thumb.blob })) ? { kind: 'added', meta } : { kind: 'skipped', why: 'no-room' }
}

/** One file after the other (a phone decodes one big picture at a time); `progress` after each. */
export async function ingestFiles(files: readonly (File | (Blob & { name: string }))[], o: { source: string; people: string[] }, d: IngestDeps, progress?: (done: number, total: number) => void): Promise<IngestResult[]> {
  const out: IngestResult[] = []
  for (const f of files) { out.push(await ingestFile(f, o, d)); progress?.(out.length, files.length) }
  return out
}
