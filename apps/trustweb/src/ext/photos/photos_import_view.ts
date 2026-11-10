// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: Import > Photos folder. Pick a folder on this device (a directory input; a plain multi-file pick works too), see every picture
 * in a review grid, and say "who is this?" by typing a name (existing people only) or for a whole sub-folder at once. Only pictures with a person are
 * kept; the rest are not copied. With Settings > Advanced > "Match faces on this device (alpha)" on, a phone number in a file name and similar pictures
 * add SUGGESTIONS the owner takes or ignores. Everything runs on this device; no file is uploaded or fetched. Drawn in a shadow root (photos.css).
 */
import { el } from '../../../../demo/src/ui/dom'
import { matchPeople } from '../../events'
import { imageMode } from '../../image_mode'
import { clusterFaces, stubEmbedder, type FaceCluster } from './face_match'
import { ingestFiles } from './photo_ingest'
import { scaleJpeg } from './photo_scale'
import { assignFolder, assignKeys, assigned, buildReview, foldersOf, setAssign, suggestAll, takeSuggestions, type PickedFile, type ReviewItem } from './photo_review'
import type { PhotosService } from './photos_service'
import css from './photos.css?inline'

const PAGE = 60
/** Identical-looking thumbnails only: the stub embedder is a byte histogram, so a high bar keeps the groups honest. */
const GROUP_AT = 0.995

type Item = ReviewItem<File>

export function importPage(svc: PhotosService): { node: HTMLElement; letGo: () => void } {
  const t = svc.ctx.strings.photos
  const host = el('div', { 'data-photos-import': '' })
  const root = host.attachShadow({ mode: 'open' })
  const ui: { items: Item[]; shown: number; note: string; busy: string; clusters: FaceCluster[]; done: boolean } = { items: [], shown: PAGE, note: '', busy: '', clusters: [], done: false }
  const urls = new Map<string, string>()
  const people = (): ReturnType<PhotosService['people']> => svc.people()
  const nameOf = (id: string | undefined): string => people().find((p) => p.id === id)?.name ?? '?'
  const faceOn = (): boolean => svc.data().faceMatch === true
  const urlOf = (it: Item): string => { let u = urls.get(it.key); if (!u) { u = URL.createObjectURL(it.file); urls.set(it.key, u) } return u }
  const letGo = (): void => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() }

  /** A "type a name" box: lists existing people that match; a tap on one calls pick. */
  function whoBox(pick: (personId: string) => void, label: string, attr: string): HTMLElement {
    const hits = el('div', { class: 'chips' })
    const input = el('input', { type: 'text', 'aria-label': label, placeholder: t.whoPh, autocomplete: 'off', [attr]: '' }) as HTMLInputElement
    input.addEventListener('input', () => {
      const q = input.value.trim()
      const found = q ? matchPeople(people() as never, q) : []
      hits.replaceChildren(...(q && !found.length ? [el('span', { class: 'meta', 'data-who-none': '' }, [t.noOne])] : found.map((p) => el('button', { type: 'button', class: 'chip', 'data-who-hit': p.id, onclick: () => pick(p.id) }, [p.name]))))
    })
    return el('div', {}, [input, hits])
  }

  function itemRow(it: Item, mode: string): HTMLElement {
    const thumb = el('span', { class: 'tile' + (mode === 'grey' ? ' grey' : '') }, [mode === 'hide' ? el('span', { class: 'none' }, [t.hiddenTile]) : el('img', { src: urlOf(it), alt: '', loading: 'lazy', decoding: 'async' })])
    const who: (Node | null)[] = it.personId
      ? [el('div', { class: 'chips' }, [el('button', { type: 'button', class: 'chip on', 'data-review-clear': it.key, 'aria-label': t.clear(nameOf(it.personId)), onclick: () => set(setAssign(ui.items, it.key, undefined)) }, [`${nameOf(it.personId)} ×`])])]
      : [
        it.suggest ? el('div', { class: 'chips' }, [el('button', { type: 'button', class: 'chip', 'data-review-suggest': it.key, onclick: () => set(setAssign(ui.items, it.key, it.suggest?.personId)) }, [t.suggestAsk(nameOf(it.suggest.personId), t.suggestFrom[it.suggest.why])])]) : null,
        whoBox((pid) => set(setAssign(ui.items, it.key, pid)), t.whoIs, 'data-review-who'),
      ]
    return el('div', { class: 'item', 'data-review-item': it.key }, [thumb, el('div', {}, [el('div', { class: 'meta' }, [it.name]), ...who])])
  }

  function set(items: Item[]): void { ui.items = items; draw() }

  async function pick(files: File[]): Promise<void> {
    letGo()
    ui.shown = PAGE; ui.clusters = []; ui.note = ''
    ui.items = buildReview(files as (File & PickedFile)[])
    if (faceOn()) ui.items = suggestAll(ui.items, { people: people() })
    draw()
  }

  async function group(): Promise<void> {
    const vecs: { photoId: string; vec: number[] | null }[] = []
    for (const [i, it] of ui.items.entries()) {
      ui.busy = t.grouping(i + 1, ui.items.length)
      const p = root.querySelector('[data-review-busy]')
      if (p) p.textContent = ui.busy
      try { vecs.push({ photoId: it.key, vec: await stubEmbedder.embed((await scaleJpeg(it.file, 256)).blob) }) } catch { vecs.push({ photoId: it.key, vec: null }) }
    }
    ui.busy = ''
    ui.clusters = clusterFaces(vecs, GROUP_AT).filter((c) => c.photoIds.length > 1)
    draw()
  }

  async function keep(): Promise<void> {
    const todo = assigned(ui.items)
    let n = 0
    const results = []
    for (const pid of [...new Set(todo.map((i) => i.personId as string))]) {
      const mine = todo.filter((i) => i.personId === pid)
      results.push(...await ingestFiles(mine.map((i) => i.file), { source: `${t.reviewTitle}: ${mine[0].path.split('/')[0]}`, people: [pid] }, svc.ingest, () => {
        n++
        const p = root.querySelector('[data-review-busy]')
        if (p) p.textContent = t.working(n, todo.length)
      }))
    }
    const why = [...new Set(results.flatMap((r) => (r.kind === 'skipped' ? [t.why[r.why]] : [])))]
    ui.note = t.result(results.filter((r) => r.kind === 'added').length, results.filter((r) => r.kind === 'duplicate').length, results.filter((r) => r.kind === 'skipped').length) + (why.length ? ` (${why.join(', ')})` : '')
    ui.items = []; ui.done = true; ui.busy = ''
    letGo()
    draw()
  }

  function draw(): void {
    const mode = imageMode()
    const dirInput = el('input', { type: 'file', accept: 'image/*', webkitdirectory: true, multiple: true, 'data-review-folder-input': '', onchange: () => { const f = Array.from(dirInput.files ?? []); dirInput.value = ''; void pick(f) } }) as HTMLInputElement
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, 'data-review-files-input': '', onchange: () => { const f = Array.from(fileInput.files ?? []); fileInput.value = ''; void pick(f) } }) as HTMLInputElement
    const choose = el('div', { class: 'bar' }, [
      el('label', { class: 'lnk', 'data-review-choose': '' }, [t.chooseFolder, dirInput]),
      el('label', { class: 'lnk', 'data-review-choose-files': '' }, [t.chooseFiles, fileInput]),
    ])
    const n = assigned(ui.items).length
    const suggestions = ui.items.filter((i) => i.suggest && !i.personId).length
    const folders = foldersOf(ui.items).filter((f) => f.folder)
    const body: (Node | null)[] = [
      el('h4', {}, [t.reviewTitle, el('sub', { class: 'alpha', 'data-alpha-label': '' }, [svc.ctx.strings.alphaLabel])]),
      el('p', { class: 'meta' }, [t.folderHint]),
      choose,
      ui.busy ? el('p', { class: 'meta', role: 'status', 'data-review-busy': '' }, [ui.busy]) : null,
      ui.note ? el('p', { class: 'meta', role: 'status', 'data-review-note': '' }, [ui.note]) : null,
    ]
    if (ui.items.length) {
      body.push(
        el('p', { class: 'meta', 'data-review-count': '' }, [t.reviewCount(ui.items.length, n)]),
        faceOn() && !ui.clusters.length && !ui.busy ? el('button', { type: 'button', class: 'lnk', 'data-review-group': '', onclick: () => { void group() } }, [t.group]) : null,
        faceOn() ? el('p', { class: 'meta' }, [t.groupStub]) : null,
        suggestions ? el('button', { type: 'button', class: 'lnk', 'data-review-take': '', onclick: () => set(takeSuggestions(ui.items)) }, [t.suggestTake(suggestions)]) : null,
        ...ui.clusters.map((c, k) => el('div', { class: 'folder', 'data-review-cluster': c.id }, [
          el('div', {}, [t.groupLine(k + 1, c.photoIds.length)]),
          whoBox((pid) => set(assignKeys(ui.items, c.photoIds, pid)), t.whoIs, 'data-review-cluster-who'),
        ])),
        ...folders.map((f) => el('div', { class: 'folder', 'data-review-folder': f.folder }, [
          el('div', {}, [t.folderAll(f.folder, f.count)]),
          whoBox((pid) => set(assignFolder(ui.items, f.folder, pid)), t.whoIs, 'data-review-folder-who'),
        ])),
        ...ui.items.slice(0, ui.shown).map((it) => itemRow(it, mode)),
        ui.items.length > ui.shown ? el('button', { type: 'button', class: 'lnk', 'data-review-more': '', onclick: () => { ui.shown += PAGE; draw() } }, [t.more(Math.min(PAGE, ui.items.length - ui.shown))]) : null,
        el('p', { class: 'meta' }, [n ? t.keepNote : t.keepNone]),
        el('button', { type: 'button', class: 'lnk', 'data-review-keep': '', ...(n && !ui.busy ? {} : { disabled: '' }), onclick: () => { ui.busy = t.working(0, n); draw(); void keep() } }, [t.keep(n)]),
      )
    }
    if (ui.done) body.push(el('button', { type: 'button', class: 'lnk', 'data-review-done': '', onclick: () => svc.back() }, [t.done]))
    root.replaceChildren(el('style', {}, [css]), el('section', { class: 'ph' }, body.filter((x): x is Node => x !== null)))
  }

  draw()
  return { node: host, letGo }
}
