// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 resources-notion-views (Jakob 2026-11-19, row 35): Notion-style views of Resources (mine, a community, an event): List (as before),
 * Table (sortable columns name, tags, shared by, when, scope), Board (columns by tag or by status), Gallery (cards). Each view keeps its own
 * filter and sort, remembered per scope in AppState.resViews; the data stay the inventory (no new store). Pure, no runtime imports
 * (apps/mcp loads it under plain node): the caller hands in how to read tags, names and the scope of an item.
 */
import type { AppState, InventoryItem, ResourceKind } from './model'

export type NotionView = 'list' | 'table' | 'board' | 'gallery'
/** The older views of My resources (resource_views.ts) stay in the same switcher. */
export type AnyView = NotionView | 'outliner' | 'person'
export type SortKey = 'name' | 'tags' | 'sharedBy' | 'when' | 'scope'
export type GroupBy = 'tag' | 'status'
export type Status = 'new' | 'received' | 'mine' | 'off'
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export interface NotionFilter { tag?: string; kind?: ResourceKind; sharedBy?: string; communityId?: string }
/** What one view of one scope remembers. */
export interface ViewState { filter?: NotionFilter; sort?: Sort; groupBy?: GroupBy }
export interface ScopePrefs { view: AnyView; views?: Partial<Record<AnyView, ViewState>> }
export type ResViews = Record<string, ScopePrefs>
/** One view's settings with defaults filled in. */
export interface ViewPrefs { view: AnyView; filter: NotionFilter; sort: Sort | null; groupBy: GroupBy }

export const NOTION_VIEWS: readonly NotionView[] = ['list', 'table', 'board', 'gallery']
export const ALL_VIEWS: readonly AnyView[] = [...NOTION_VIEWS, 'outliner', 'person']
export const SORT_KEYS: readonly SortKey[] = ['name', 'tags', 'sharedBy', 'when', 'scope']
export const GROUP_BYS: readonly GroupBy[] = ['tag', 'status']
export const STATUSES: readonly Status[] = ['new', 'received', 'mine', 'off']
/** resource_views.ts RESOURCE_KINDS (this file stays free of runtime imports). */
const KINDS: readonly ResourceKind[] = ['book', 'publication', 'reference', 'recording', 'link', 'other']

type Holder = Pick<AppState, 'resViews'>

/** 'mine' | 'community:<id>' | 'event:<id>', with ':references' for the References page. */
export function scopeKey(sc: { kind: 'community' | 'event'; id: string } | null, page: 'resources' | 'references' = 'resources'): string {
  return (sc ? `${sc.kind}:${sc.id}` : 'mine') + (page === 'references' ? ':references' : '')
}

export const prefsOf = (s: Holder, key: string): ScopePrefs => s.resViews?.[key] ?? { view: 'list' }

export function viewPrefs(s: Holder, key: string, view?: AnyView): ViewPrefs {
  const p = prefsOf(s, key)
  const v = view ?? p.view
  const st = p.views?.[v] ?? {}
  return { view: v, filter: { ...st.filter }, sort: st.sort ?? null, groupBy: st.groupBy ?? 'tag' }
}

export interface ViewPatch { view: string; sort?: { key: string; dir: string } | null; groupBy?: string; filter?: Partial<Record<keyof NotionFilter, string>> }

/** Switches the scope to `view` and stores what is given: sort null clears it, a filter field '' clears that field. Throws on a wrong value. */
export function setViewPrefs(s: Holder, key: string, patch: ViewPatch): ViewPrefs {
  const view = patch.view as AnyView
  if (!ALL_VIEWS.includes(view)) throw new Error(`view must be one of ${ALL_VIEWS.join(', ')}`)
  if (patch.sort) {
    if (!SORT_KEYS.includes(patch.sort.key as SortKey)) throw new Error(`sort must be one of ${SORT_KEYS.join(', ')}`)
    if (patch.sort.dir !== 'asc' && patch.sort.dir !== 'desc') throw new Error('dir must be asc or desc')
  }
  if (patch.groupBy !== undefined && !GROUP_BYS.includes(patch.groupBy as GroupBy)) throw new Error(`groupBy must be one of ${GROUP_BYS.join(', ')}`)
  if (patch.filter?.kind && !KINDS.includes(patch.filter.kind as ResourceKind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)
  const all = (s.resViews ??= {})
  const p = (all[key] ??= { view })
  p.view = view
  const st: ViewState = { ...p.views?.[view] }
  if (patch.sort === null) delete st.sort
  else if (patch.sort) st.sort = { key: patch.sort.key as SortKey, dir: patch.sort.dir as Sort['dir'] }
  if (patch.groupBy) st.groupBy = patch.groupBy as GroupBy
  if (patch.filter) {
    const f: Record<string, string> = { ...st.filter }
    for (const [k, v] of Object.entries(patch.filter)) if (v) f[k] = v; else delete f[k]
    st.filter = f as NotionFilter
    if (Object.keys(f).length === 0) delete st.filter
  }
  p.views = { ...p.views, [view]: st }
  return viewPrefs(s, key, view)
}

export const statusOf = (i: Pick<InventoryItem, 'included' | 'sharedBy' | 'openedAt'>): Status =>
  !i.included ? 'off' : i.sharedBy ? (i.openedAt === undefined ? 'new' : 'received') : 'mine'

/** How the caller reads an item: its tags (resource_scope.ts itemTags), a person's name, its scope label ('' = none). */
export interface RowCtx { tagsOf: (i: InventoryItem) => { id: string; label: string }[]; nameOf: (id: string) => string | undefined; scopeOf: (i: InventoryItem) => string }
/** One table row: the five columns, the tag ids for the filter and the board, and the item itself. sharedBy '' = me. */
export interface NotionRow { id: string; item: InventoryItem; name: string; tags: string[]; tagIds: string[]; sharedBy: string; when: number; scope: string; status: Status }

/** The Scope column: the item's event (as #event:<name>), else its community, else a community among its tags; '' = none (just mine). */
export function scopeLabelOf(i: InventoryItem, tags: readonly { id: string; label?: string; community?: boolean }[], events: readonly { id: string; name: string; tagName?: string }[], et: { label: (name: string) => string }): string {
  const ev = i.eventId ? events.find((e) => e.id === i.eventId) : undefined
  if (ev) return et.label(ev.tagName ?? ev.name)
  const t = tags.find((x) => x.id === i.communityId) ?? tags.find((x) => x.community === true && (i.tagAudience ?? []).includes(x.id))
  return t ? t.label ?? t.id : ''
}

export function notionRows(items: readonly InventoryItem[], c: RowCtx): NotionRow[] {
  return items.map((i) => {
    const t = c.tagsOf(i)
    return { id: i.id, item: i, name: i.text, tags: t.map((x) => x.label), tagIds: t.map((x) => x.id), sharedBy: i.sharedBy ? c.nameOf(i.sharedBy) ?? i.sharedBy : '', when: i.createdAt, scope: c.scopeOf(i), status: statusOf(i) }
  })
}

export const filterRows = (rows: readonly NotionRow[], f: NotionFilter): NotionRow[] => rows.filter((r) =>
  (!f.tag || r.tagIds.includes(f.tag)) && (!f.kind || (r.item.kind ?? 'other') === f.kind) && (!f.sharedBy || r.item.sharedBy === f.sharedBy) && (!f.communityId || r.item.communityId === f.communityId))

const cell = (r: NotionRow, k: SortKey): string | number => (k === 'when' ? r.when : k === 'tags' ? r.tags.join(', ') : r[k])

/** Stable; text compares case-insensitively and empty cells stay last both ways (as Notion does). null keeps the order. */
export function sortRows(rows: readonly NotionRow[], sort: Sort | null): NotionRow[] {
  if (!sort) return [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows.map((r, n) => ({ r, n, v: cell(r, sort.key) })).sort((a, b) => {
    const ea = a.v === '', eb = b.v === ''
    if (ea !== eb) return ea ? 1 : -1
    const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base' })
    return d * sign || a.n - b.n
  }).map((x) => x.r)
}

/** A header tap: another column starts ascending (When: newest first); the same column flips. */
export const nextSort = (cur: Sort | null, key: SortKey): Sort =>
  cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'when' ? 'desc' : 'asc' }

export interface BoardColumn { id: string; label: string; rows: NotionRow[] }

/** By tag: a column per tag in the order first met (an item sits in each of its tags), untagged last (id ''). By status: STATUSES order. Empty columns are skipped. */
export function boardColumns(rows: readonly NotionRow[], by: GroupBy): BoardColumn[] {
  if (by === 'status') return STATUSES.map((st) => ({ id: st, label: st, rows: rows.filter((r) => r.status === st) })).filter((c) => c.rows.length)
  const cols: BoardColumn[] = []
  for (const r of rows) r.tagIds.forEach((id, n) => { let c = cols.find((x) => x.id === id); if (!c) cols.push(c = { id, label: r.tags[n], rows: [] }); c.rows.push(r) })
  const none = rows.filter((r) => r.tagIds.length === 0)
  return none.length ? [...cols, { id: '', label: '', rows: none }] : cols
}

/** What a view shows: filtered and sorted rows, and the board's columns. The app and MCP (resources_view_set) share it. */
export function arrange(items: readonly InventoryItem[], c: RowCtx, p: ViewPrefs): { rows: NotionRow[]; columns: BoardColumn[] } {
  const rows = sortRows(filterRows(notionRows(items, c), p.filter), p.sort)
  return { rows, columns: p.view === 'board' ? boardColumns(rows, p.groupBy) : [] }
}
