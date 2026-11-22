// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 resource-event-private: a community resource kept private to ONE event's participants. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addEventPrivate, communityEvents, partitionScope } from '../../src/resource_scope.ts'
import { itemAdmits } from '../../src/cascade.ts'
import { eventTagLabel, eventTagSlug } from '../../src/event_tag.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const NOW = Date.parse('2026-11-19T10:00:00Z')
const et = { slug: eventTagSlug, label: eventTagLabel }
const ev = { id: 'e1', name: 'Winter OG', communityId: 'iyg' }
const community = { kind: 'community', id: 'iyg', label: 'IYG' }

describe('addEventPrivate', () => {
  it('carries the event tag only (no community tag), the event id and the community, rings closed', () => {
    const items = []
    const i = addEventPrivate(items, ev, et, 'resources', ' Sled ', 'r1', NOW, { kind: 'typed' })
    expect(i).toMatchObject({ id: 'r1', text: 'Sled', audience: 'me', tagAudience: [eventTagSlug('Winter OG')], eventId: 'e1', communityId: 'iyg' })
    expect(items).toHaveLength(1)
    expect(addEventPrivate(items, ev, et, 'references', 'Paper', 'r2', NOW, { kind: 'typed' }).kind).toBe('reference')
    expect(addEventPrivate(items, ev, et, 'resources', '  ', 'r3', NOW, { kind: 'typed' })).toBeNull()
  })
  it('still shows in that community\'s Resources for me', () => {
    const items = []
    addEventPrivate(items, ev, et, 'resources', 'Sled', 'r1', NOW, { kind: 'typed' })
    expect(partitionScope(items, community).shared.map((x) => x.id)).toEqual(['r1'])
  })
  it('answers only someone holding the event tag: the community tag, a friend ring or nobody get nothing (I9)', () => {
    const [i] = (() => { const l = []; addEventPrivate(l, ev, et, 'resources', 'Sled', 'r1', NOW, { kind: 'typed' }); return l })()
    expect(itemAdmits(i, 'friends', 0, [eventTagSlug('Winter OG')])).toBe(true)
    expect(itemAdmits(i, 'friends', 0, ['iyg'])).toBe(false)
    expect(itemAdmits(i, 'acquaintances', 0, [])).toBe(false)
    expect(itemAdmits(i, 'friends', 0, [])).toBe(false)
  })
})

describe('communityEvents', () => {
  it('lists the events of one community', () => {
    const evs = [ev, { id: 'e2', name: 'Other', community: 'iyg' }, { id: 'e3', name: 'Else', communityId: 'zz' }, { id: 'e4', name: 'Free' }]
    expect(communityEvents(evs, 'iyg').map((e) => e.id)).toEqual(['e1', 'e2'])
  })
})

describe('MCP resource_add audience event:<id>', () => {
  function fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w45-rep-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [], events: [{ id: 'e1', name: 'Winter OG', communityId: 'iyg', from: '2026-12-30', createdAt: 1, attended: true }] }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    return { by: Object.fromEntries(allTools({ file, write: true, now: () => new Date(NOW) }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('keeps the resource private to that event and in its community', () => {
    const f = fixture()
    f.by.resource_add.run({ title: 'Sled', audience: 'event:e1' })
    expect(f.rec().inventory[0]).toMatchObject({ text: 'Sled', audience: 'me', tagAudience: [eventTagSlug('Winter OG')], eventId: 'e1', communityId: 'iyg' })
  })
  it('rejects an unknown event or a malformed audience', () => {
    const f = fixture()
    expect(() => f.by.resource_add.run({ title: 'x', audience: 'event:nope' })).toThrow(/event/)
    expect(() => f.by.resource_add.run({ title: 'x', audience: 'world' })).toThrow(/audience/)
  })
})
