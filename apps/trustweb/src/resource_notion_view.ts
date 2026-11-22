// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 resources-notion-views: the view pill row and the Table, Board and Gallery bodies of Resources (mine, community, event), plus the
 * per-view sort and tag filter. Logic and storage: resource_notion.ts (AppState.resViews, per scope key). Used by resource_views_view.ts (mine)
 * and resource_scope_view.ts (a community or an event).
 */
import { el } from '../../demo/src/ui/dom'
import type { InventoryItem } from './model'
import { SORT_KEYS, arrange, nextSort, setViewPrefs, viewPrefs } from './resource_notion'
import type { AnyView, NotionRow, ResViews, RowCtx, SortKey, ViewPatch, ViewPrefs } from './resource_notion'
import { S } from './strings'

export interface NotionCtx extends RowCtx {
  /** The object holding AppState.resViews (the app state). */
  state: { resViews?: ResViews }
  key: string
  items: readonly InventoryItem[]
  open: (id: string) => void
  save: () => void
  render: () => void
  /** The item's attached picture (image_store.ts, this phone only). */
  image?: (id: string) => Promise<Blob | null>
  /** True: its link stays hidden (protected resource). */
  hideLink?: (i: InventoryItem) => boolean
}

const label = (v: AnyView): string => (v === 'table' || v === 'board' || v === 'gallery' ? S.w45nv.view[v] : S.resViews.view[v])

/** Stores a change of the current view (resource_notion.ts setViewPrefs), saves and redraws. */
export function patchView(c: Pick<NotionCtx, 'state' | 'key' | 'save' | 'render'>, patch: Omit<ViewPatch, 'view'> & { view?: string }): void {
  setViewPrefs(c.state, c.key, { view: patch.view ?? viewPrefs(c.state, c.key).view, ...patch })
  c.save()
  c.render()
}

const pill = (on: boolean, attrs: Record<string, string>, text: string, click: () => void): HTMLElement =>
  el('button', { class: 'btn btn-ghost btn-sm' + (on ? '' : ' tw-off'), 'aria-pressed': String(on), type: 'button', ...attrs, onclick: click }, [text])

/** The view switcher pill row. */
export function viewPills(c: Pick<NotionCtx, 'state' | 'key' | 'save' | 'render'>, views: readonly AnyView[]): HTMLElement {
  const cur = viewPrefs(c.state, c.key).view
  return el('div', { class: 'rv-switch nv-switch', role: 'group', 'aria-label': S.w45nv.viewsAria, 'data-nv-switch': c.key }, views.map((v) =>
    pill(cur === v, { 'data-rv-view': v, 'data-nv-view': v }, label(v), () => patchView(c, { view: v }))))
}

/** Sort (and, on a board, grouping) and the tag filter of the current view; shown behind the Filters expander. */
export function viewTools(c: NotionCtx): HTMLElement[] {
  const p = viewPrefs(c.state, c.key)
  const tags: { id: string; label: string }[] = []
  for (const i of c.items) for (const t of c.tagsOf(i)) if (!tags.some((x) => x.id === t.id)) tags.push(t)
  const sortSel = el('select', { class: 'field nv-sort', 'data-nv-sort': '', 'aria-label': S.w45nv.sortBy, onchange: (e: Event) => {
    const k = (e.target as HTMLSelectElement).value as SortKey | ''
    patchView(c, { sort: k ? { key: k, dir: k === 'when' ? 'desc' : 'asc' } : null })
  } }, [el('option', { value: '' }, [S.w45nv.sortNone]), ...SORT_KEYS.map((k) => el('option', { value: k, ...(p.sort?.key === k ? { selected: '' } : {}) }, [S.w45nv.col[k]]))])
  const dir = p.sort ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-nv-dir': p.sort.dir, 'aria-label': S.w45nv.dirAria, onclick: () => patchView(c, { sort: nextSort(p.sort, p.sort!.key) }) }, [p.sort.dir === 'asc' ? S.w45nv.asc : S.w45nv.desc]) : null
  const out = [el('div', { class: 'rv-chips nv-sortrow' }, [el('span', { class: 'nv-lbl' }, [S.w45nv.sortBy]), sortSel, dir])]
  if (tags.length) out.push(el('div', { class: 'rv-chips', 'data-nv-tags': '' }, [
    pill(!p.filter.tag, { 'data-nv-tag': '' }, S.w45nv.allTags, () => patchView(c, { filter: { tag: '' } })),
    ...tags.map((t) => pill(p.filter.tag === t.id, { 'data-nv-tag': t.id }, t.label, () => patchView(c, { filter: { tag: p.filter.tag === t.id ? '' : t.id } }))),
  ]))
  return out
}

/** Board grouping pills (Tag / Status), always visible on a board. */
function groupPills(c: NotionCtx, p: ViewPrefs): HTMLElement {
  return el('div', { class: 'rv-chips nv-group', role: 'group', 'aria-label': S.w45nv.groupBy }, [el('span', { class: 'nv-lbl' }, [S.w45nv.groupBy]),
    ...(['tag', 'status'] as const).map((g) => pill(p.groupBy === g, { 'data-nv-group': g }, S.w45nv.group[g], () => patchView(c, { groupBy: g })))])
}

const when = (t: number): string => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })
const shareCell = (r: NotionRow): string => r.sharedBy || S.w45nv.me
const chips = (r: NotionRow): HTMLElement | null => r.tags.length ? el('div', { class: 'cal-chips' }, r.tags.map((t) => el('span', { class: 'cal-chip' }, [t]))) : null

function table(c: NotionCtx, p: ViewPrefs, rows: readonly NotionRow[]): HTMLElement {
  const th = (k: SortKey): HTMLElement => {
    const on = p.sort?.key === k
    return el('th', { scope: 'col', 'aria-sort': on ? (p.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, [
      el('button', { class: 'nv-th', type: 'button', 'data-nv-col': k, 'aria-label': S.w45nv.sortAria(S.w45nv.col[k]), onclick: () => patchView(c, { sort: nextSort(p.sort, k) }) },
        [S.w45nv.col[k], on ? (p.sort!.dir === 'asc' ? ' ↑' : ' ↓') : '']),
    ])
  }
  return el('div', { class: 'nv-table-wrap', 'data-nv-table': '' }, [el('table', { class: 'nv-table' }, [
    el('thead', {}, [el('tr', {}, SORT_KEYS.map(th))]),
    el('tbody', {}, rows.map((r) => el('tr', { 'data-nv-row': r.id }, [
      el('td', {}, [el('button', { class: 'nv-name', type: 'button', 'data-item': r.id, onclick: () => c.open(r.id) }, [r.name])]),
      el('td', {}, [chips(r)]),
      el('td', {}, [shareCell(r)]),
      el('td', { title: new Date(r.when).toLocaleString() }, [when(r.when)]),
      el('td', {}, [r.scope || S.w45nv.mine]),
    ]))),
  ])])
}

const card = (c: NotionCtx, r: NotionRow, cls: string, extra: Node | null = null): HTMLElement =>
  el('button', { class: cls, type: 'button', 'data-nv-card': r.id, onclick: () => c.open(r.id) }, [extra, el('b', {}, [r.name]), chips(r), el('span', { class: 'nv-sub' }, [shareCell(r), ' · ', when(r.when)])])

function board(c: NotionCtx, p: ViewPrefs, columns: ReturnType<typeof arrange>['columns']): HTMLElement {
  const title = (id: string, lbl: string): string => p.groupBy === 'status' ? S.w45nv.status[id as keyof typeof S.w45nv.status] : (id ? lbl : S.w45nv.noTag)
  return el('div', { class: 'nv-board', 'data-nv-board': p.groupBy }, columns.map((col) => el('section', { class: 'nv-col', 'data-nv-column': col.id }, [
    el('h4', {}, [title(col.id, col.label), el('span', { class: 'nv-count' }, [String(col.rows.length)])]),
    ...col.rows.map((r) => card(c, r, 'nv-card')),
  ])))
}

/** Link host of an item (shown, never fetched: no third-party request for a preview). */
function host(i: InventoryItem): string | null {
  try { const u = new URL(i.link ?? ''); return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.replace(/^www\./, '') : null } catch { return null }
}

function preview(c: NotionCtx, i: InventoryItem): HTMLElement {
  const box = el('div', { class: 'nv-preview', 'aria-hidden': 'true' })
  const h = c.hideLink?.(i) ? null : host(i)
  box.append(h ? el('span', { class: 'nv-host', 'data-nv-host': '' }, [h]) : el('span', { class: 'nv-initial' }, [(i.text.trim()[0] ?? '·').toUpperCase()]))
  if (i.imageId && c.image) {
    void c.image(i.imageId).then((b) => {
      if (!b) return
      const url = URL.createObjectURL(b)
      box.replaceChildren(el('img', { src: url, alt: '', 'data-nv-img': '', onload: () => URL.revokeObjectURL(url) }))
    })
  }
  return box
}

/** The body of Table, Board or Gallery (null for the other views, which their own module draws). */
export function notionBody(c: NotionCtx): Node[] | null {
  const p = viewPrefs(c.state, c.key)
  if (p.view !== 'table' && p.view !== 'board' && p.view !== 'gallery') return null
  const a = arrange(c.items, c, p)
  if (a.rows.length === 0) return [p.view === 'board' ? groupPills(c, p) : null, el('p', { class: 'empty', 'data-nv-empty': '' }, [S.w45nv.empty])].filter((n): n is HTMLElement => n !== null)
  if (p.view === 'table') return [table(c, p, a.rows)]
  if (p.view === 'board') return [groupPills(c, p), board(c, p, a.columns)]
  return [el('div', { class: 'nv-gallery', 'data-nv-gallery': '' }, a.rows.map((r) => card(c, r, 'nv-gcard', preview(c, r.item))))]
}

/** The items of the List-like views in the saved filter and sort of the current view. */
export const arrangedItems = (c: NotionCtx): InventoryItem[] => arrange(c.items, c, viewPrefs(c.state, c.key)).rows.map((r) => r.item)
