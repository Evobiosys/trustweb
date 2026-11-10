// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: what the module's views share: the store of this record, the ingest dependencies, the people to pick from and the few things
 * asked of the host app (a page with Back, a notice, a save) over the module bus. Modules never import main.ts.
 */
import { randomId } from '../../../../demo/src/crypto'
import type { Person } from '../../model'
import { basisOf } from '../../share_page_view'
import type { TwCtx } from '../tw_registry'
import type { IngestDeps } from './photo_ingest'
import { roomFor, scaleJpeg, sha256Hex } from './photo_scale'
import { PhotoStore } from './photo_store'
import { MODULE_ID, parsePhotos, photosDbName, type PhotosData } from './photos_data'

export interface PhotosService {
  ctx: TwCtx
  store: PhotoStore
  ingest: IngestDeps
  people: () => Person[]
  data: () => PhotosData
  setData: (d: PhotosData) => void
  toast: (msg: string) => void
  /** Opens a page with Back (the app's own pages). */
  page: (title: string, body: Node[], mark: string) => void
  back: () => void
}

export function createService(ctx: TwCtx): PhotosService {
  const store = new PhotoStore(photosDbName(ctx.store().me.id), typeof indexedDB === 'undefined' ? undefined : indexedDB)
  return {
    ctx, store,
    ingest: { store, scale: scaleJpeg, hash: sha256Hex, newId: () => randomId(10), now: () => Date.now(), room: roomFor },
    people: () => basisOf(ctx.store()).people as Person[],
    data: () => parsePhotos(ctx.store().extData?.[MODULE_ID]),
    setData: (d) => { const s = ctx.store(); s.extData = { ...s.extData, [MODULE_ID]: d }; ctx.bus.emit('save') },
    toast: (msg) => ctx.bus.emit('toast', msg),
    page: (title, body, mark) => ctx.bus.emit('open-page', { title, body, mark }),
    back: () => ctx.bus.emit('back'),
  }
}
