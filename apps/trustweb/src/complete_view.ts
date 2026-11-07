// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 complete-view: everyone in one table (cards below 900 px), the alternative to the rings. Owner-only, local: sort by any column,
 * filters, multi-select with the People list's bulk actions plus delete with Undo, inline cadence and tags, keyboard, a render window
 * beyond 500 rows, and "Export (3 files)". Every edit saves through the host's `save`.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Person, Ring } from './model'
import { ringColor } from './model'
import type { ColourTag } from './colour_tags'
import { archivePerson } from './archived_people'
import { BULK_RINGS, clearSelection, restoreSnapshot, snapshot, toggle } from './multi_select'
import type { Selection } from './multi_select'
import { CADENCE_CHOICES, setCadence } from './cadence'
import { activeFilters } from './filter_active'
import { addTagToPeople, completeRows, DEFAULT_SORT, deletePeople, groupsOf, setPersonTag, sortRows, toggleSort, visibleWindow } from './complete_view_model'
import type { CompleteRow, SortKey } from './complete_view_model'
import { EXPORT_FILES, peopleCsv, timelineCsv, updatesCsv } from './complete_export'
import { download } from './contacts_sync_view'
import { lastContact } from './people_list'
import { S } from './strings'

/** What the table needs from main.ts. */
export interface CompleteIo {
  state(): AppState
  save(): void
  open(id: string): void
  place(id: string, ring: Ring): void
  toast(msg: string, undo: () => void): void
  tags(): ColourTag[]
  saveTags(tags: readonly ColourTag[]): void
  focusSearch(): void
}

const COLS: readonly SortKey[] = ['name', 'ring', 'last', 'next', 'cadence', 'tags', 'groups', 'channels', 'notes', 'affil']
/** More rows than this are drawn as a window around the scroll position. */
const WINDOW_FROM = 500
const OVERSCAN = 8
const ROW_TABLE = 44
const ROW_CARD = 116

let query = ''
let sort = DEFAULT_SORT
let overdueOnly = false
let quietOnly = false
let selected: Selection = clearSelection()
let focusId: string | undefined
let redraw: () => void = () => undefined

/** A fresh visit starts unfiltered, drifted contacts first. */
export function resetComplete(startQuery = '', startOverdue = false): void {
  query = startQuery
  sort = DEFAULT_SORT
  overdueOnly = startOverdue
  quietOnly = false
  selected = clearSelection()
  focusId = undefined
}
export const completeQuery = (): string => query
export function setCompleteQuery(q: string): void {
  query = q
  redraw()
}

const dateText = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export function completeView(io: CompleteIo): HTMLElement {
  const wide = window.matchMedia('(min-width: 900px)')
  const root = el('div', { class: 'cv', 'data-complete-view': '' })
  const bar = el('div', { class: 'cv-bar' })
  const head = el('div', { class: 'cv-head', role: 'row' })
  const sortPick = el('select', { class: 'field cv-sort', 'data-cv-sort-select': '', 'aria-label': S.completeSortAria(''), onchange: (e: Event) => { sort = { key: (e.target as HTMLSelectElement).value as SortKey, dir: 1 }; refresh() } })
  const body = el('div', { class: 'cv-body', role: 'rowgroup', tabindex: '0', 'aria-label': S.viewNames.complete })
  const bulk = el('div', { class: 'select-bar cv-bulk', 'data-select-bar': '' })
  let rows: CompleteRow[] = []
  let drawn = ''

  const rowH = (): number => (wide.matches ? ROW_TABLE : ROW_CARD)
  const people = (): Person[] => io.state().people
  const changed = (): void => { io.save(); root.dispatchEvent(new CustomEvent('people-changed', { bubbles: true })); refresh() }

  const cadenceSelect = (r: CompleteRow): HTMLElement => el('select', {
    class: 'field cv-cadence', 'data-cv-cadence': r.id, 'aria-label': S.completeCadenceAria(r.name),
    onchange: (e: Event) => {
      const p = people().find((x) => x.id === r.id)
      const n = Number((e.target as HTMLSelectElement).value)
      if (!p) return
      setCadence(p, n)
      changed()
    },
  }, [el('option', { value: '0' }, [S.completeCadenceOff]), ...CADENCE_CHOICES.map((d) => el('option', { value: String(d), ...(d === r.cadence ? { selected: '' } : {}) }, [S.completeCadenceEvery(d)]))])

  const tagCell = (r: CompleteRow): HTMLElement => {
    const addTag = (input: HTMLInputElement): void => {
      const p = people().find((x) => x.id === r.id)
      const name = input.value.trim()
      if (!p || !name) return
      const out = addTagToPeople([p], new Set([p.id]), io.tags(), name)
      if (out.tags !== io.tags()) io.saveTags(out.tags)
      changed()
    }
    const input = el('input', { class: 'field cv-tag-input', 'data-cv-tag-input': r.id, placeholder: S.completeTagPh, 'aria-label': S.completeTagAria(r.name), maxlength: '40' }) as HTMLInputElement
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(input) } })
    return el('span', { class: 'cv-c cv-c-tags' }, [
      ...r.tags.map((t) => el('span', { class: 'cv-tag' + (t.own ? '' : ' inherited'), 'data-cv-tag': t.id }, [
        t.label,
        t.own ? el('button', { class: 'cv-tag-x', 'aria-label': S.completeTagRemove(t.label), onclick: () => { const p = people().find((x) => x.id === r.id); if (p) { setPersonTag(p, t.id, false); changed() } } }, ['×']) : null,
      ])),
      input,
    ])
  }

  const rowEl = (r: CompleteRow): HTMLElement => {
    const dim = (v: string, cls: string): HTMLElement => el('span', { class: `cv-c cv-c-${cls}`, title: v }, [v])
    const row = el('div', { class: 'cv-row' + (selected.has(r.id) ? ' sel' : '') + (focusId === r.id ? ' focus' : '') + (r.overdue ? ' overdue' : ''), role: 'row', 'data-cv-row': r.id, style: `--rc:${ringColor({ ring: r.ring })}` }, [
      el('input', { type: 'checkbox', class: 'cv-check', 'data-cv-check': r.id, checked: selected.has(r.id), 'aria-label': S.completeSelectRow(r.name), onchange: () => { selected = toggle(selected, r.id); focusId = r.id; refreshBulk(); redrawRows(true) } }),
      el('button', { class: 'cv-c cv-c-name linkbtn', 'data-cv-open': r.id, title: r.name, onclick: () => io.open(r.id) }, [r.name]),
      dim(S.peopleZone[r.ring], 'ring'),
      dim(r.last ? dateText(r.last) : S.completeNever, 'last'),
      el('span', { class: 'cv-c cv-c-next' + (r.overdue ? ' due' : '') }, [r.next === undefined ? '' : dateText(r.next)]),
      el('span', { class: 'cv-c cv-c-cadence' }, [cadenceSelect(r)]),
      tagCell(r),
      dim(r.groups.join(', '), 'groups'),
      dim(r.channels.map((c) => S.completeChannelShort[c] ?? c).join(' '), 'channels'),
      dim(r.notes ? String(r.notes) : '', 'notes'),
      dim(r.affil, 'affil'),
    ])
    return row
  }

  /** Draws the rows (all, or the window around the scroll position beyond 500). */
  function redrawRows(force = false): void {
    const h = rowH()
    const view = body.clientHeight || window.innerHeight
    const windowed = rows.length > WINDOW_FROM
    const { start, end } = windowed ? visibleWindow(body.scrollTop, h, view, rows.length, OVERSCAN) : { start: 0, end: rows.length }
    const key = `${start}-${end}-${h}-${rows.length}`
    if (!force && key === drawn) return
    drawn = key
    const slice = rows.slice(start, end).map(rowEl)
    body.replaceChildren(
      ...(windowed ? [el('div', { class: 'cv-spacer', style: `height:${start * h}px` })] : []),
      ...(slice.length ? slice : [el('p', { class: 'meta cv-empty', 'data-cv-empty': '' }, [S.completeEmpty])]),
      ...(windowed ? [el('div', { class: 'cv-spacer', style: `height:${(rows.length - end) * h}px` })] : []),
    )
    body.style.setProperty('--row-h', h + 'px')
  }

  function refreshBar(total: number): void {
    const st = io.state()
    const chips = activeFilters(st.uiRings, io.tags(), st.people).filter((f) => f.chip.startsWith('person:') || f.chip.startsWith('tag:'))
    bar.replaceChildren(
      el('span', { class: 'cv-count', 'data-cv-count': '' }, [S.completeCount(rows.length, total)]),
      el('button', { class: 'linkbtn cv-chip' + (overdueOnly ? ' on' : ''), 'data-cv-overdue': '', 'aria-pressed': String(overdueOnly), onclick: () => { overdueOnly = !overdueOnly; refresh() } }, [S.completeOverdue]),
      el('button', { class: 'linkbtn cv-chip' + (quietOnly ? ' on' : ''), 'data-cv-quiet': '', 'aria-pressed': String(quietOnly), onclick: () => { quietOnly = !quietOnly; refresh() } }, [S.keepQuiet]),
      ...chips.map((f) => el('button', { class: 'linkbtn cv-chip on', 'data-cv-filter': f.chip, onclick: () => {
        const ui = io.state().uiRings
        if (ui) { ui.show = ui.show?.filter((c) => c !== f.chip); ui.hide = ui.hide?.filter((c) => c !== f.chip) }
        changed()
      } }, [S.completeFilterOff(f.label)])),
      el('button', { class: 'linkbtn cv-export', 'data-cv-export': '', onclick: exportFiles }, [S.completeExport]),
    )
    head.replaceChildren(el('span', { class: 'cv-c cv-c-check' }), ...COLS.map((k) => el('button', {
      class: `cv-c cv-c-${k} cv-th linkbtn`, role: 'columnheader', 'data-cv-sort': k, 'aria-label': S.completeSortAria(S.completeCols[k]), 'aria-sort': sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none',
      onclick: () => { sort = toggleSort(sort, k); refresh() },
    }, [S.completeCols[k] + (sort.key === k ? S.completeSortMark[sort.dir === 1 ? 0 : 1] : '')])))
    sortPick.replaceChildren(...COLS.map((k) => el('option', { value: k, ...(k === sort.key ? { selected: '' } : {}) }, [S.completeCols[k]])))
  }

  function exportFiles(): void {
    const s = io.state()
    const now = Date.now()
    const ids = selected.size ? selected : new Set(rows.map((r) => r.id))
    const list = people().filter((p) => ids.has(p.id))
    const tags = io.tags()
    const ctx = { s, opts: { now, ringLabel: (r: Ring) => S.ringLabel[r], lastContact: (p: Person) => lastContact(s, p) || undefined }, groupsOf: (p: Person) => groupsOf(s, p, tags) }
    const files = [peopleCsv, timelineCsv, updatesCsv]
    EXPORT_FILES.forEach((name, i) => download(name, 'text/csv;charset=utf-8', files[i](list, ctx)))
    io.toast(S.completeExported(list.length), () => undefined)
  }

  // The bulk bar: the People list's actions (move ring, add tag, archive) plus delete, each with one Undo.
  function refreshBulk(): void {
    const n = selected.size
    if (!n) { bulk.hidden = true; bulk.replaceChildren(); return }
    bulk.hidden = false
    const chosen = (): Person[] => people().filter((p) => selected.has(p.id))
    const done = (): void => { selected = clearSelection(); changed() }
    const tag = el('input', { class: 'field select-tag', 'data-select-tag': '', placeholder: S.completeBulkTagPh, 'aria-label': S.selectTag, maxlength: '40' }) as HTMLInputElement
    const addTag = (): void => {
      const name = tag.value.trim()
      if (!name) return
      const out = addTagToPeople(people(), selected, io.tags(), name)
      if (out.tags !== io.tags()) io.saveTags(out.tags)
      const count = n
      done()
      io.toast(S.selectTagged(count, name), () => { out.undo(); changed() })
    }
    tag.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } })
    bulk.replaceChildren(
      el('span', { class: 'select-count', 'data-select-count': '' }, [S.selectCount(n)]),
      el('select', { class: 'field select-move', 'data-select-move': '', 'aria-label': S.selectMove, onchange: (e: Event) => {
        const ring = (e.target as HTMLSelectElement).value as Ring
        if (!ring) return
        const list = chosen()
        const snaps = snapshot(people(), selected)
        for (const p of list) io.place(p.id, ring)
        done()
        io.toast(S.selectMoved(list.length, S.peopleZone[ring]), () => { for (const sn of snaps) io.place(sn.id, sn.ring); restoreSnapshot(people(), snaps); changed() })
      } }, [el('option', { value: '' }, [S.selectMove]), ...BULK_RINGS.map((r) => el('option', { value: r }, [S.peopleZone[r]]))]),
      el('span', { class: 'select-tagrow' }, [tag, el('button', { class: 'row-tool linkbtn', 'data-select-tag-add': '', onclick: addTag }, [S.selectTag])]),
      el('button', { class: 'row-tool linkbtn', 'data-select-archive': '', onclick: () => {
        const snaps = snapshot(people(), selected)
        for (const p of chosen()) archivePerson(p)
        const count = n
        done()
        io.toast(S.selectArchived(count), () => { restoreSnapshot(people(), snaps); changed() })
      } }, [S.selectArchive]),
      el('button', { class: 'row-tool linkbtn', 'data-select-delete': '', onclick: () => {
        const list = chosen()
        const undo = deletePeople(people(), selected, Date.now())
        done()
        io.toast((list.length === 1 ? S.deletedToast(list[0].name) : S.deletedToastMany(list.length)) + S.completeTapUndo, () => { undo(); changed() })
      } }, [S.completeDelete]),
      el('button', { class: 'row-tool linkbtn', 'data-select-done': '', onclick: () => { selected = clearSelection(); refreshBulk(); redrawRows(true) } }, [S.selectDone]),
    )
  }

  function refresh(): void {
    const st = io.state()
    const base = { s: st, tags: io.tags(), now: Date.now() }
    const total = completeRows(base, { query: '', overdueOnly: false }).length
    rows = sortRows(completeRows(base, { query, overdueOnly, quietOnly }), sort)
    refreshBar(total)
    refreshBulk()
    redrawRows(true)
  }

  // Keyboard on the table: arrows move the focused row, Space selects, Enter opens, / searches, Escape clears the selection.
  body.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    const i = rows.findIndex((r) => r.id === focusId)
    const go = (to: number): void => {
      const at = Math.max(0, Math.min(rows.length - 1, to))
      if (!rows[at]) return
      focusId = rows[at].id
      const h = rowH()
      if (at * h < body.scrollTop) body.scrollTop = at * h
      else if ((at + 1) * h > body.scrollTop + body.clientHeight) body.scrollTop = (at + 1) * h - body.clientHeight
      redrawRows(true)
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i < 0 ? 0 : i - 1) }
    else if (e.key === ' ' && focusId) { e.preventDefault(); selected = toggle(selected, focusId); refreshBulk(); redrawRows(true) }
    else if (e.key === 'Enter' && focusId && !(e.target as HTMLElement).closest('button')) io.open(focusId)
    else if (e.key === '/') { e.preventDefault(); io.focusSearch() }
    else if (e.key === 'Escape' && selected.size) { selected = clearSelection(); refreshBulk(); redrawRows(true) }
  })
  body.addEventListener('scroll', () => redrawRows())
  wide.addEventListener('change', () => refresh())
  redraw = refresh
  root.append(bar, el('div', { class: 'cv-sortrow' }, [sortPick]), head, body, bulk)
  refresh()
  requestAnimationFrame(() => redrawRows(true)) // the first draw ran before the table had a height
  return root
}
