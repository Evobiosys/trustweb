// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 groups-to-join: local ranking of groups I could join or help (src/group_fit.ts). Pure. */
import { fit, myTags, rankGroups, warmPath } from '../../src/group_fit.ts'

const person = (id, ring, over = {}) => ({ id, name: id.toUpperCase(), ring, lines: [], ...over })
const group = (id, over = {}) => ({ id, name: id, tags: [], members: [], updatedAt: 1, ...over })
const interests = (text) => ({ interests: { text, at: 1, by: 'me' } })

describe('myTags', () => {
  it('reads my profile interests, lower-cased and split', () => {
    expect(myTags({ people: [], profile: { norms: [], ...interests('Soil, Water; Local Food') } })).toEqual(['soil', 'water', 'local food'])
  })
  it('falls back to the zone tags I use most', () => {
    const zoneTags = { friend: { ids: ['a', 'b'], stamp: 1 }, close: { ids: ['b'], stamp: 1 } }
    expect(myTags({ people: [], zoneTags })).toEqual(['b', 'a'])
  })
  it('empty state has none', () => expect(myTags({ people: [] })).toEqual([]))
})

describe('fit', () => {
  const base = { people: [person('a', 'closest'), person('b', 'friend'), person('c', 'none')], profile: { norms: [], ...interests('soil, water, bees') } }
  it('alignment is the Jaccard overlap with my tags', () => {
    const f = fit(group('g', { tags: ['soil', 'water', 'wind'] }), base)
    expect(f.alignment).toBeCloseTo(2 / 4)
  })
  it('a member note mentioning a group tag adds a small boost', () => {
    const s = { ...base, people: [person('a', 'closest', { lines: [{ text: 'works on wind power' }] })] }
    const plain = fit(group('g', { tags: ['wind'], members: ['b'] }), s).alignment
    const noted = fit(group('g', { tags: ['wind'], members: ['a'] }), s).alignment
    expect(noted).toBeGreaterThan(plain)
    expect(noted).toBeLessThanOrEqual(1)
  })
  it('closeness weighs members by ring and caps at 1', () => {
    expect(fit(group('g', { members: ['b'] }), base).closeness).toBeCloseTo(0.6)
    expect(fit(group('g', { members: ['a', 'b'] }), base).closeness).toBe(1)
  })
  it('archived or unknown people count for nothing', () => {
    const f = fit(group('g', { members: ['c', 'zzz'] }), base)
    expect(f.closeness).toBe(0)
    expect(f.reasons.join(' ')).not.toMatch(/know/i)
  })
  it('family counts by its closeness slot', () => {
    const s = { people: [person('f', 'family', { fields: { 'tw-closeness': 'friend' } })] }
    expect(fit(group('g', { members: ['f'] }), s).closeness).toBeCloseTo(0.6)
  })
  it('resources map 0..3 to 0..1', () => {
    expect(fit(group('g'), base).resources).toBe(0)
    expect(fit(group('g', { resources: 3 }), base).resources).toBe(1)
    expect(fit(group('g', { resources: 2 }), base).resources).toBeCloseTo(2 / 3)
  })
  it('total = 0.5 alignment + 0.3 closeness + 0.2 resources', () => {
    const f = fit(group('g', { tags: ['soil'], members: ['b'], resources: 3 }), base)
    expect(f.total).toBeCloseTo(0.5 * f.alignment + 0.3 * f.closeness + 0.2 * f.resources)
  })
  it('reasons use plain words', () => {
    const f = fit(group('g', { tags: ['soil', 'water'], members: ['a', 'b'], resources: 2 }), base)
    expect(f.reasons).toEqual(['2 shared interests: soil, water', 'You know 2 people there', 'Good resources (your estimate)'])
  })
  it('one person reads singular', () => {
    expect(fit(group('g', { members: ['a'] }), base).reasons).toEqual(['You know 1 person there'])
  })
})

describe('rankGroups', () => {
  const s = { people: [person('a', 'closest')], profile: { norms: [], ...interests('soil') }, groups: [
    group('z', { name: 'Zeta', tags: ['soil'] }), group('b', { name: 'Beta', tags: ['soil'] }), group('top', { name: 'Top', tags: ['soil'], members: ['a'], resources: 3 }), group('low', { name: 'Low' }),
  ] }
  it('sorts by total desc, ties by name', () => {
    expect(rankGroups(s).map((r) => r.group.id)).toEqual(['top', 'b', 'z', 'low'])
  })
  it('empty state gives an empty list', () => {
    expect(rankGroups({ people: [] })).toEqual([])
  })
})

describe('warmPath', () => {
  const people = [
    person('m1', 'friend'), person('m2', 'closest'), person('gone', 'none'),
    person('x', 'close', { knows: ['m1'] }), person('y', 'acquaintance', { knows: ['x'] }), person('n', 'close', { knows: ['gone'] }),
  ]
  const g = group('g', { members: ['m1', 'm2', 'gone'] })
  it('members by closeness first, then one hop via a member', () => {
    const path = warmPath(g, { people })
    expect(path.map((w) => w.person.id)).toEqual(['m2', 'm1', 'x'])
    expect(path[2].via.id).toBe('m1')
    expect(path[0].via).toBeUndefined()
  })
  it('never goes a second hop and skips archived people', () => {
    const ids = warmPath(g, { people }).map((w) => w.person.id)
    expect(ids).not.toContain('y')
    expect(ids).not.toContain('gone')
    expect(ids).not.toContain('n')
  })
  it('at most 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => person(`p${i}`, 'friend'))
    expect(warmPath(group('g', { members: many.map((p) => p.id) }), { people: many })).toHaveLength(5)
  })
})

describe('groups stay on this phone', () => {
  it('the device sync leaves them out (the page says "Only on this phone")', async () => {
    const { SYNC_EXCLUDED, settingsOf } = await import('../../src/sync_core.ts')
    expect(SYNC_EXCLUDED.has('groups')).toBe(true)
    expect(settingsOf({ groups: [group('g')] })).toEqual({})
  })
})
