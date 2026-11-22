// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 resources-notion-views (MCP parity): resources_view_set picks a scope's view, filter, sort and board grouping, and answers what the view shows. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const P = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], fields: {} })
const item = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpnv-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({
    v: 1, people: [P('a', 'Ada Lovelace')], sameAs: {}, meetings: [],
    inventory: [item('1', { text: 'zebra', createdAt: 5, tagAudience: ['c1'], sharedBy: 'a' }), item('2', { text: 'apple', createdAt: 9, tagAudience: ['c1'] }), item('3', { text: 'mango', createdAt: 7 })],
    events: [{ id: 'e1', name: 'Camp' }],
    extData: { 'community-mighty': { meta: { c1: { kind: 'informal', organizers: ['me'], name: 'Forum' } } } },
  }))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-19T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('resources_view_set', () => {
  it('needs writes on', () => {
    expect(Object.keys(fixture(false).by)).not.toContain('resources_view_set')
    expect(Object.keys(fixture().by)).toContain('resources_view_set')
  })
  it('stores a table sort for my resources and answers the sorted rows', () => {
    const f = fixture()
    const out = f.by.resources_view_set.run({ view: 'table', sort: 'name', dir: 'asc' })
    expect(out.key).toBe('mine')
    expect(out.rows.map((r) => r.id)).toEqual(['2', '3', '1'])
    expect(out.rows[2]).toMatchObject({ name: 'zebra', tags: ['Forum'], sharedBy: 'Ada Lovelace', scope: 'Forum', status: 'new' })
    expect(f.rec().resViews.mine).toEqual({ view: 'table', views: { table: { sort: { key: 'name', dir: 'asc' } } } })
  })
  it('a community board grouped by status lists only that community', () => {
    const f = fixture()
    const out = f.by.resources_view_set.run({ scope: 'community', community: 'c1', view: 'board', groupBy: 'status' })
    expect(out.key).toBe('community:c1')
    expect(out.columns).toEqual([{ id: 'new', label: 'new', ids: ['1'] }, { id: 'mine', label: 'mine', ids: ['2'] }])
  })
  it('filters by tag; an empty value clears it; sort none clears the sort', () => {
    const f = fixture()
    f.by.resources_view_set.run({ view: 'gallery', tag: 'c1', sort: 'when', dir: 'desc' })
    expect(f.by.resources_view_set.run({ view: 'gallery' }).rows.map((r) => r.id)).toEqual(['2', '1'])
    expect(f.by.resources_view_set.run({ view: 'gallery', tag: '', sort: 'none' }).rows.map((r) => r.id)).toEqual(['1', '2', '3'])
  })
  it('refuses a wrong view, an unknown community or event', () => {
    const f = fixture()
    expect(() => f.by.resources_view_set.run({ view: 'kanban' })).toThrow(/view/)
    expect(() => f.by.resources_view_set.run({ scope: 'community', community: 'zz', view: 'table' })).toThrow(/community/)
    expect(() => f.by.resources_view_set.run({ scope: 'event', event: 'zz', view: 'table' })).toThrow(/event/)
  })
})
