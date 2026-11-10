// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the "Photos" section of a person card. A grid of 256 px thumbnails (tap: the picture large, with Remove and Share), "Add photos"
 * (the device picker, several at once, linked to this person), Select for sharing several, and "Recently removed" (30 days, Restore).
 * Drawn in a shadow root (CSS scoped, photos.css); every listener sits on an element of that root, so letting go of the host leaves none behind.
 * Images follow Tools > Images: show / grey out / hide.
 */
import { el } from '../../../../demo/src/ui/dom'
import { imageMode } from '../../image_mode'
import { ingestFiles } from './photo_ingest'
import { formatBytes, photosOf, restore, storageShare, tombstone, trashedOf, type PhotoMeta } from './photo_model'
import { storageEstimate } from './photo_scale'
import { usageOf } from './photo_store'
import type { PhotosService } from './photos_service'
import { openShare } from './photos_share_view'
import css from './photos.css?inline'

/** Mounts (or redraws) the section into `host`; returns the function that lets go of its object URLs. */
export function mountCardPhotos(svc: PhotosService, personId: string, host: HTMLElement): () => void {
  const t = svc.ctx.strings.photos
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const ui = { select: false, picked: new Set<string>(), note: '', trash: false }
  let urls: string[] = []      // the object URLs of the grid on screen
  let gen = 0
  const revoke = (list: string[]): void => { for (const u of list) URL.revokeObjectURL(u) }
  const letGo = (): void => { revoke(urls); urls = [] }
  const name = (): string => svc.ctx.store().people.find((p) => p.id === personId)?.name ?? '?'

  async function tile(m: PhotoMeta, mode: string, made: string[], onTap: () => void): Promise<HTMLElement> {
    const blob = mode === 'hide' ? null : await svc.store.blob(m.id, 'thumb')
    const src = blob ? URL.createObjectURL(blob) : ''
    if (src) made.push(src)
    const inner = mode === 'hide' ? el('span', { class: 'none' }, [t.hiddenTile]) : el('img', { src, alt: '', loading: 'lazy' })
    const picked = ui.select && ui.picked.has(m.id)
    return el('button', {
      type: 'button', class: 'tile' + (mode === 'grey' ? ' grey' : ''), 'data-photo-tile': m.id, 'aria-label': name(), ...(ui.select ? { 'aria-pressed': String(picked) } : {}), onclick: onTap,
    }, [inner, picked ? el('span', { class: 'tick', 'aria-hidden': 'true' }, ['✓']) : null])
  }

  async function viewer(list: PhotoMeta[], at: number): Promise<void> {
    const m = list[at]
    const dlg = el('dialog', { 'data-photo-viewer': m.id, 'aria-label': t.viewAria(at + 1, list.length) })
    const mode = imageMode()
    const blob = mode === 'hide' ? null : await svc.store.blob(m.id, 'full')
    const full = blob ? URL.createObjectURL(blob) : ''
    const close = (): void => { dlg.close(); dlg.remove(); if (full) URL.revokeObjectURL(full) }
    dlg.append(
      mode === 'hide' ? el('p', { class: 'meta' }, [t.hiddenTile]) : el('div', { class: mode === 'grey' ? 'grey' : '' }, [el('img', { src: full, alt: '' })]),
      el('p', { class: 'meta', 'data-photo-source': '' }, [`${new Date(m.addedAt).toLocaleDateString()} · ${m.source} · ${formatBytes(m.bytes)}`]),
      el('div', { class: 'bar' }, [
        el('button', { type: 'button', class: 'lnk', 'data-photo-share-one': '', onclick: () => { close(); openShare(svc, [m.id]) } }, [t.shareOne]),
        el('button', { type: 'button', class: 'lnk', 'data-photo-remove': m.id, onclick: () => { close(); void svc.store.update(m.id, (x) => tombstone(x, Date.now())).then(() => { svc.toast(t.removed(1)); void draw() }) } }, [t.remove]),
        el('button', { type: 'button', class: 'lnk', 'data-photo-close': '', onclick: close }, [t.close]),
      ]),
    )
    dlg.addEventListener('cancel', close)
    root.append(dlg)
    dlg.showModal()
  }

  async function draw(): Promise<void> {
    const mine = ++gen
    const made: string[] = []
    const mode = imageMode()
    const all = await svc.store.list()
    const now = Date.now()
    const live = photosOf(all, personId)
    const gone = trashedOf(all, personId, now)
    const q = await storageEstimate()
    const tiles = await Promise.all(live.map((m, i) => tile(m, mode, made, () => { if (ui.select) { if (ui.picked.has(m.id)) ui.picked.delete(m.id); else ui.picked.add(m.id); void draw() } else void viewer(live, i) })))
    const goneTiles = ui.trash ? await Promise.all(gone.map(async (m) => el('div', {}, [await tile(m, mode, made, () => {}), el('button', { type: 'button', class: 'lnk', 'data-photo-restore': m.id, onclick: () => { void svc.store.update(m.id, restore).then(() => draw()) } }, [t.restore])]))) : []
    if (mine !== gen) { revoke(made); return }   // a newer draw is on its way
    const input = el('input', {
      type: 'file', accept: 'image/*', multiple: true, 'data-photo-input': personId,
      onchange: () => { const files = Array.from(input.files ?? []); input.value = ''; void add(files) },
    }) as HTMLInputElement
    const picked = [...ui.picked].filter((id) => live.some((m) => m.id === id))
    const section = el('section', { class: 'ph', 'data-photos-section': personId }, [
      el('h4', {}, [t.section, el('sub', { class: 'alpha', 'data-alpha-label': '' }, [svc.ctx.strings.alphaLabel])]),
      live.length ? el('div', { class: 'grid', 'data-photo-grid': '' }, tiles) : el('p', { class: 'meta', 'data-photos-empty': '' }, [t.empty(name())]),
      el('div', { class: 'bar' }, [
        el('label', { class: 'lnk', 'data-photo-add': '' }, [t.add, input]),
        live.length ? el('button', { type: 'button', class: 'lnk', 'data-photo-select': '', 'aria-pressed': String(ui.select), onclick: () => { ui.select = !ui.select; ui.picked.clear(); void draw() } }, [ui.select ? t.selectDone : t.select]) : null,
        ui.select && picked.length ? el('button', { type: 'button', class: 'lnk', 'data-photo-share-n': '', onclick: () => openShare(svc, picked) }, [t.shareN(picked.length)]) : null,
      ]),
      ui.note ? el('p', { class: 'meta', role: 'status', 'data-photo-note': '' }, [ui.note]) : null,
      gone.length ? el('button', { type: 'button', class: 'lnk', 'data-photo-trash': '', 'aria-expanded': String(ui.trash), onclick: () => { ui.trash = !ui.trash; void draw() } }, [t.recentlyRemoved(gone.length)]) : null,
      goneTiles.length ? el('div', { class: 'grid' }, goneTiles) : null,
      el('p', { class: 'meta', 'data-photo-storage': '' }, [t.storage(formatBytes(usageOf(all)), q.quota ? formatBytes(q.quota) : '', storageShare(usageOf(all), q.quota)), ' ', t.storageNote]),
    ])
    root.replaceChildren(el('style', {}, [css]), section)
    revoke(urls)
    urls = made
  }

  async function add(files: File[]): Promise<void> {
    ui.note = t.working(0, files.length)
    const results = await ingestFiles(files, { source: t.pickedSource, people: [personId] }, svc.ingest, (done, total) => {
      const p = root.querySelector('[data-photo-note]')
      if (p) p.textContent = t.working(done, total)
    })
    const why = [...new Set(results.flatMap((r) => (r.kind === 'skipped' ? [t.why[r.why]] : [])))]
    ui.note = t.result(results.filter((r) => r.kind === 'added').length, results.filter((r) => r.kind === 'duplicate').length, results.filter((r) => r.kind === 'skipped').length) + (why.length ? ` (${why.join(', ')})` : '')
    await draw()
  }

  void draw()
  return letGo
}
