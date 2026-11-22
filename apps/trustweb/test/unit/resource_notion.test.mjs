// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 resources-notion-views: Notion-style views of Resources (src/resource_notion.ts): per-scope prefs, rows, filter, sort, board, toggles. */
import {
  ALL_VIEWS, NOTION_VIEWS, SORT_KEYS, scopeLabelOf, scopeKey, prefsOf, viewPrefs, setViewPrefs, notionRows, filterRows, sortRows, boardColumns, statusOf, nextSort, arrange,
} from '../../src/resource_notion.ts'

const it1 = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
const TAGS = { t1: 'Forum', t2: 'Garden' }
const ctx = {
  tagsOf: (i) => (i.tagAudience ?? []).map((id) => ({ id, label: TAGS[id] ?? id })),
  nameOf: (id) => ({ a: 'Ada', b: 'Bo' })[id],
  scopeOf: (i) => (i.communityId ? TAGS[i.communityId] : ''),
}
const items = [
  it1('1', { text: 'banana', createdAt: 30, tagAudience: ['t2'], sharedBy: 'b' }),
  it1('2', { text: 'Apple', createdAt: 10, tagAudience: ['t1', 't2'], communityId: 't1' }),
  it1('3', { text: 'cherry', createdAt: 20, sharedBy: 'a', openedAt: 5, included: false }),
  it1('4', { text: 'date', createdAt: 40, sharedBy: 'a' }),
]

describe('views and keys', () => {
  it('lists the four Notion views with List first, then the older ones', () => {
    expect(NOTION_VIEWS).toEqual(['list', 'table', 'board', 'gallery'])
    expect(ALL_VIEWS).toEqual(['list', 'table', 'board', 'gallery', 'outliner', 'person'])
    expect(SORT_KEYS).toEqual(['name', 'tags', 'sharedBy', 'when', 'scope'])
  })
  it('keys a scope: mine, community, event; references apart', () => {
    expect(scopeKey(null)).toBe('mine')
    expect(scopeKey({ kind: 'community', id: 'c1' })).toBe('community:c1')
    expect(scopeKey({ kind: 'event', id: 'e1' }, 'references')).toBe('event:e1:references')
  })
})

describe('prefs per scope', () => {
  it('defaults to List without filter or sort', () => {
    expect(prefsOf({}, 'mine')).toEqual({ view: 'list' })
    expect(viewPrefs({}, 'mine')).toEqual({ view: 'list', filter: {}, sort: null, groupBy: 'tag' })
  })
  it('remembers view, filter, sort and grouping per scope and per view', () => {
    const s = {}
    setViewPrefs(s, 'community:c1', { view: 'table', sort: { key: 'name', dir: 'asc' }, filter: { tag: 't1' } })
    setViewPrefs(s, 'community:c1', { view: 'board', groupBy: 'status' })
    expect(prefsOf(s, 'community:c1').view).toBe('board')
    expect(viewPrefs(s, 'community:c1', 'table')).toEqual({ view: 'table', filter: { tag: 't1' }, sort: { key: 'name', dir: 'asc' }, groupBy: 'tag' })
    expect(viewPrefs(s, 'community:c1').groupBy).toBe('status')
    expect(prefsOf(s, 'mine')).toEqual({ view: 'list' })
  })
  it('clears a sort with null and a filter field with an empty value', () => {
    const s = {}
    setViewPrefs(s, 'mine', { view: 'table', sort: { key: 'when', dir: 'desc' }, filter: { tag: 't1', kind: 'book' } })
    setViewPrefs(s, 'mine', { view: 'table', sort: null, filter: { tag: '' } })
    expect(viewPrefs(s, 'mine')).toEqual({ view: 'table', filter: { kind: 'book' }, sort: null, groupBy: 'tag' })
  })
  it('refuses a wrong view, sort key, direction, grouping or kind', () => {
    expect(() => setViewPrefs({}, 'mine', { view: 'kanban' })).toThrow(/view/)
    expect(() => setViewPrefs({}, 'mine', { view: 'table', sort: { key: 'size', dir: 'asc' } })).toThrow(/sort/)
    expect(() => setViewPrefs({}, 'mine', { view: 'table', sort: { key: 'name', dir: 'up' } })).toThrow(/dir/)
    expect(() => setViewPrefs({}, 'mine', { view: 'board', groupBy: 'colour' })).toThrow(/group/)
    expect(() => setViewPrefs({}, 'mine', { view: 'list', filter: { kind: 'film' } })).toThrow(/kind/)
  })
})

describe('rows, filter, sort', () => {
  const rows = notionRows(items, ctx)
  it('builds one row per item with the five columns and a status', () => {
    expect(rows[1]).toMatchObject({ id: '2', name: 'Apple', tags: ['Forum', 'Garden'], sharedBy: '', when: 10, scope: 'Forum', status: 'mine' })
    expect(rows[0].sharedBy).toBe('Bo')
  })
  it('status: off, new, received, mine', () => {
    expect(items.map(statusOf)).toEqual(['new', 'mine', 'off', 'new'])
    expect(statusOf(it1('x', { sharedBy: 'a', openedAt: 3 }))).toBe('received')
  })
  it('filters by tag id, kind, sharer and community', () => {
    expect(filterRows(rows, { tag: 't1' }).map((r) => r.id)).toEqual(['2'])
    expect(filterRows(rows, { sharedBy: 'a' }).map((r) => r.id)).toEqual(['3', '4'])
    expect(filterRows(rows, { communityId: 't1' }).map((r) => r.id)).toEqual(['2'])
    expect(filterRows(rows, { kind: 'other' }).length).toBe(4)
    expect(filterRows(rows, { kind: 'book' }).length).toBe(0)
  })
  it('sorts by each column, both ways, case-insensitive; none keeps the order', () => {
    expect(sortRows(rows, { key: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1', '3', '4'])
    expect(sortRows(rows, { key: 'when', dir: 'desc' }).map((r) => r.id)).toEqual(['4', '1', '3', '2'])
    expect(sortRows(rows, { key: 'sharedBy', dir: 'asc' }).map((r) => r.id)).toEqual(['3', '4', '1', '2'])
    expect(sortRows(rows, { key: 'tags', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1', '3', '4'])
    expect(sortRows(rows, { key: 'scope', dir: 'desc' }).map((r) => r.id)[0]).toBe('2')
    expect(sortRows(rows, null).map((r) => r.id)).toEqual(['1', '2', '3', '4'])
  })
  it('a header tap: new column asc (When: newest first), same column flips', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort(null, 'when')).toEqual({ key: 'when', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'scope')).toEqual({ key: 'scope', dir: 'asc' })
  })
})

describe('scope column', () => {
  const tags = [{ id: 'c1', label: 'Forum', community: true }, { id: 'p', label: 'Garden' }]
  const events = [{ id: 'e1', name: 'Camp' }]
  const et = { slug: (n) => `event_${n}`, label: (n) => `#event:${n}` }
  it('event first, then the community, then a community tag; else empty', () => {
    expect(scopeLabelOf(it1('a', { eventId: 'e1', communityId: 'c1' }), tags, events, et)).toBe('#event:Camp')
    expect(scopeLabelOf(it1('a', { communityId: 'c1' }), tags, events, et)).toBe('Forum')
    expect(scopeLabelOf(it1('a', { tagAudience: ['p', 'c1'] }), tags, events, et)).toBe('Forum')
    expect(scopeLabelOf(it1('a', { tagAudience: ['p'] }), tags, events, et)).toBe('')
  })
})

describe('board', () => {
  const rows = notionRows(items, ctx)
  it('by tag: a column per tag (first met), an item in each of its tags, untagged last', () => {
    const cols = boardColumns(rows, 'tag')
    expect(cols.map((c) => [c.id, c.label, c.rows.map((r) => r.id)])).toEqual([['t2', 'Garden', ['1', '2']], ['t1', 'Forum', ['2']], ['', '', ['3', '4']]])
  })
  it('by status: fixed order, empty columns skipped', () => {
    expect(boardColumns(rows, 'status').map((c) => [c.id, c.rows.map((r) => r.id)])).toEqual([['new', ['1', '4']], ['mine', ['2']], ['off', ['3']]])
  })
})

describe('arrange (what a view shows; MCP answers the same)', () => {
  it('applies the saved filter and sort of the view', () => {
    const s = {}
    setViewPrefs(s, 'mine', { view: 'table', sort: { key: 'name', dir: 'desc' }, filter: { sharedBy: 'a' } })
    expect(arrange(items, ctx, viewPrefs(s, 'mine')).rows.map((r) => r.id)).toEqual(['4', '3'])
  })
  it('a board answers columns', () => {
    const a = arrange(items, ctx, { view: 'board', filter: {}, sort: { key: 'when', dir: 'desc' }, groupBy: 'status' })
    expect(a.columns.map((c) => c.id)).toEqual(['new', 'mine', 'off'])
    expect(a.columns[0].rows.map((r) => r.id)).toEqual(['4', '1'])
  })
})
