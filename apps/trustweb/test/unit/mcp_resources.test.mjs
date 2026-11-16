// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views (MCP parity P02): resources_list, resource_set_kind, resource_set_suggester over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const P = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], fields: {} })
const item = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcprv-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [P('a', 'Ada Lovelace')], sameAs: {}, meetings: [], inventory: [item('1', { kind: 'book', sharedBy: 'a' }), item('2', { kind: 'recording', protected: true, link: 'https://x.org' })] }))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('resource tools', () => {
  it('resources_list is a read; the two setters need writes on', () => {
    expect(Object.keys(fixture(false).by)).toContain('resources_list')
    for (const n of ['resource_set_kind', 'resource_set_suggester']) { expect(Object.keys(fixture(false).by)).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('resources_list filters by kind and by a person name', () => {
    const f = fixture()
    expect(f.by.resources_list.run({ kind: 'book' }).items.map((i) => i.id)).toEqual(['1'])
    expect(f.by.resources_list.run({ sharedBy: 'Ada Lovelace' }).items.map((i) => i.id)).toEqual(['1'])
  })
  it('resources_list hides the link of a protected resource and groups by view', () => {
    const f = fixture()
    const rec = f.by.resources_list.run({ kind: 'recording' }).items[0]
    expect(rec.protected).toBe(true)
    expect(rec.link).toBeUndefined()
    expect(f.by.resources_list.run({ view: 'person' }).groups.length).toBe(2)
    expect(() => f.by.resources_list.run({ view: 'x' })).toThrow(/view/)
  })
  it('resource_set_kind stores the kind and refuses a wrong one', () => {
    const f = fixture()
    expect(f.by.resource_set_kind.run({ id: '1', kind: 'publication' })).toEqual({ id: '1', kind: 'publication' })
    expect(f.rec().inventory[0].kind).toBe('publication')
    expect(() => f.by.resource_set_kind.run({ id: '1', kind: 'zzz' })).toThrow(/kind/)
    expect(() => f.by.resource_set_kind.run({ id: 'nope', kind: 'book' })).toThrow(/no resource/)
  })
  it('resource_set_suggester turns a known name into the id, keeps a free name, empty clears', () => {
    const f = fixture()
    expect(f.by.resource_set_suggester.run({ id: '1', by: 'ada lovelace' })).toEqual({ id: '1', recommendedBy: 'a' })
    expect(f.by.resource_set_suggester.run({ id: '1', by: 'Verein X' }).recommendedBy).toBe('Verein X')
    f.by.resource_set_suggester.run({ id: '1', by: '' })
    expect(f.rec().inventory[0].recommendedBy).toBeUndefined()
  })
})
