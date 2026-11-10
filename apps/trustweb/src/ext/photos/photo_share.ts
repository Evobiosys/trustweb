// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: "Share these photos with <zone / tag>". It rides the existing share model (share_page.ts): ONE share line for the item
 * `photos:<bundle id>` whose scope (zone, include, exclude) decides who may see it, the same canAccess as every other share, so the preview and
 * the enforcement cannot disagree. Next to it a PhotoBundle entry (ids and hashes, never a picture) and, per recipient, the manifest sealed with the
 * same pair key the notes relay uses (notes_relay.ts sealJson), like the co-notes share route.
 * STUB, on purpose: the sealed manifest is made (and opened in tests) but nothing is sent to a relay, and the picture bytes do not travel yet.
 * Pure: no I/O, the clock and the id are passed in.
 */
import type { Identity } from '../../../../demo/src/did'
import { openJson, sealJson } from '../../notes_relay'
import { previewOf, shareItem, type Basis } from '../../share_page'
import type { Scope, ShareLine } from '../../share_sink/share_lines'
import type { PhotoBundle } from './photos_data'

export const bundleItem = (bundleId: string): string => `photos:${bundleId}`

export interface SharePlan { bundle: PhotoBundle; lines: ShareLine[]; preview: { count: number; names: string[] } }

/** Who would see these photos and the record's share lines with the new one appended; null for an empty selection. Nothing is saved here. */
export function planShare(b: Basis, o: { photos: readonly { id: string; hash: string }[]; scope: Scope; now: Date; newId: () => string }): SharePlan | null {
  if (!o.photos.length) return null
  const id = o.newId()
  const item = bundleItem(id)
  const preview = previewOf(b, o.scope, item, o.now)
  const names = new Set(preview.names)
  const bundle: PhotoBundle = {
    id, photoIds: o.photos.map((p) => p.id), hashes: o.photos.map((p) => p.hash), scope: o.scope, createdAt: o.now.getTime(),
    recipients: b.people.filter((p) => names.has(p.name)).map((p) => p.id), transport: 'stub',
  }
  return { bundle, lines: shareItem(b, item, o.scope, o.now), preview }
}

/** What a recipient's device would read: the manifest only. */
export interface BundleManifest { kind: 'photo-bundle'; v: 1; id: string; hashes: string[]; count: number; at: number }

export const sealBundleFor = (bundle: PhotoBundle, me: Identity, toDid: string): Promise<Uint8Array> =>
  sealJson({ kind: 'photo-bundle', v: 1, id: bundle.id, hashes: bundle.hashes, count: bundle.photoIds.length, at: bundle.createdAt } satisfies BundleManifest, me, toDid)

/** The manifest `fromDid` sealed for `me`; null when it does not open or is no manifest. Never throws. */
export async function openBundle(bytes: Uint8Array, me: Identity, fromDid: string): Promise<BundleManifest | null> {
  const v = await openJson(bytes, me, fromDid) as Partial<BundleManifest> | null
  return v && v.kind === 'photo-bundle' && v.v === 1 && typeof v.id === 'string' && Array.isArray(v.hashes) && typeof v.count === 'number' && typeof v.at === 'number' ? v as BundleManifest : null
}
