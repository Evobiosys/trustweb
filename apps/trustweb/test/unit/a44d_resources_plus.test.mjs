// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-44d item 2: "+ Add resource" in a community / event scoped Resources or References view (pre-tagged, shared into the community) and the
 *  "shared by <name> · <time>" line of every item there; MCP resource_add for parity. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addScoped, partitionScope } from '../../src/resource_scope.ts'
import { sharedByLine } from '../../src/resource_scope_view.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const NOW = Date.parse('2026-11-18T10:00:00Z')
const community = { kind: 'community', id: 'iyg', label: 'IYG' }
const event = { kind: 'event', id: 'e1', label: '#event:Winter OG', tagIds: ['event_winter-og'] }

describe('addScoped', () => {
  it('a community resource carries the community tag, only that tag sees it (I9), and lands in Shared by me', () => {
    const items = []
    const i = addScoped(items, community, 'resources', ' Tent ', 'r1', NOW, { kind: 'typed' })
    expect(i).toMatchObject({ id: 'r1', text: 'Tent', tagAudience: ['iyg'], audience: 'me', included: true, createdAt: NOW, source: { kind: 'typed' } })
    expect(i.kind).toBeUndefined()
    expect(partitionScope(items, community).shared.map((x) => x.id)).toEqual(['r1'])
  })
  it('on References it is a reference; in an event scope it carries the event tag', () => {
    const items = []
    expect(addScoped(items, community, 'references', 'Paper', 'r2', NOW, { kind: 'typed' }).kind).toBe('reference')
    expect(addScoped(items, event, 'resources', 'Sled', 'r3', NOW, { kind: 'typed' }).tagAudience).toEqual(['event_winter-og'])
    expect(partitionScope(items, event).shared.map((x) => x.id)).toEqual(['r3'])
  })
  it('an empty title adds nothing', () => {
    const items = []
    expect(addScoped(items, community, 'resources', '   ', 'r4', NOW, { kind: 'typed' })).toBeNull()
    expect(items).toEqual([])
  })
})

describe('sharedByLine', () => {
  const names = (id) => ({ p1: 'Ben Gruber' })[id]
  it('the sender of a received item, "me" for mine, with a compact age and the absolute time', () => {
    expect(sharedByLine({ id: 'x', text: 't', createdAt: NOW - 3 * 3600_000, sharedBy: 'p1' }, names, NOW)).toMatchObject({ name: 'Ben Gruber', age: '3h', at: NOW - 3 * 3600_000 })
    expect(sharedByLine({ id: 'y', text: 't', createdAt: NOW - 2 * 86_400_000 }, names, NOW)).toMatchObject({ name: null, age: '2d' })
    expect(sharedByLine({ id: 'z', text: 't', createdAt: NOW, sharedBy: 'gone' }, names, NOW).name).toBe('gone')
  })
})

describe('MCP resource_add', () => {
  function fixture(write = true) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-a44d-res-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [], events: [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', createdAt: 1, attended: true }] }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    return { file, by: Object.fromEntries(allTools({ file, write, now: () => new Date(NOW) }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('adds a resource into a community or an event (or my plain list), as the + row does', () => {
    const f = fixture()
    expect(f.by.resource_add.run({ title: 'Tent', community: 'iyg' })).toMatchObject({ text: 'Tent', tagAudience: ['iyg'] })
    f.by.resource_add.run({ title: 'Sled', event: 'e1', reference: true })
    f.by.resource_add.run({ title: 'Drill' })
    const inv = f.rec().inventory
    expect(inv.map((i) => [i.text, i.tagAudience ?? null, i.kind ?? null, i.audience])).toEqual([['Tent', ['iyg'], null, 'me'], ['Sled', ['event_Winter_OG'], 'reference', 'me'], ['Drill', null, null, 'fof']])
    expect(() => f.by.resource_add.run({ title: 'x', event: 'nope' })).toThrow(/event/)
    expect(() => f.by.resource_add.run({ title: ' ' })).toThrow(/title/)
  })
  it('needs writes on', () => expect(Object.keys(fixture(false).by)).not.toContain('resource_add'))
})
