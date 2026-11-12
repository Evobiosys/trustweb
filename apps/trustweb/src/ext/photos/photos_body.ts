// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: what the dynamic import yields. init opens this record's photo store, drops photos whose 30-day tombstone ran out and answers the
 * app's 'person-card' event (the card asks for its Photos section; no subscriber: no section); dispose undoes both. Settings > Extensions > Photos: the
 * storage line and the folder import.
 */
import { el } from '../../../../demo/src/ui/dom'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { formatBytes, storageShare } from './photo_model'
import { storageEstimate } from './photo_scale'
import { usageOf } from './photo_store'
import { MODULE_ID } from './photos_data'
import { mountCardPhotos } from './photos_card'
import { importPage } from './photos_import_view'
import { createService, type PhotosService } from './photos_service'

let svc: PhotosService | null = null
let off: (() => void)[] = []
const cards = new Map<string, () => void>()
const imports = new Set<() => void>()

function settingsRows(ctx: TwCtx): Node[] {
  const t = ctx.strings.photos
  const s = svc
  if (!s) return []
  const line = el('p', { class: 'meta', 'data-photos-storage-line': '' }, [t.storageNote])
  void Promise.all([s.store.list(), storageEstimate()]).then(([all, q]) => { line.textContent = `${t.storage(formatBytes(usageOf(all)), q.quota ? formatBytes(q.quota) : '', storageShare(usageOf(all), q.quota))} ${t.storageNote}` })
  return [
    line,
    el('button', {
      class: 'linkbtn', 'data-photos-import-open': '',
      onclick: () => { const p = importPage(s); imports.add(p.letGo); s.page(t.folder, [p.node], 'photos-import') },
    }, [t.folder]),
  ]
}

export const body: TwModuleBody = {
  init(ctx) {
    const s = createService(ctx)
    svc = s
    void s.store.purgeExpired(Date.now())
    off.push(ctx.bus.on('person-card', (d) => {
      const { personId, host } = d as { personId: string; host: HTMLElement }
      cards.get(personId)?.()
      cards.set(personId, mountCardPhotos(s, personId, host))
    }))
  },
  dispose() {
    for (const f of off) f()
    off = []
    for (const f of [...cards.values(), ...imports]) f()
    cards.clear()
    imports.clear()
    svc = null
  },
  settings: (ctx) => [{ id: MODULE_ID, title: ctx.strings.photos.title, rows: () => settingsRows(ctx) }],
}
