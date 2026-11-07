// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 35 rings-filters-2: one limit for every ring, rank by frequency, active chip. */
import { drawnLimit, frequency, pickFive, rankedBy } from '../../src/membranes_five.ts'
import { activeFilters } from '../../src/filter_active.ts'
import { S } from '../../src/strings.ts'

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 7)
const person = (id, extra = {}) => ({ id, name: id, ring: 'acquaintance', peerId: 'peer-' + id, metAt: 0, fields: [], ...extra })
const msgs = (n, ageDays) => ({ messages: Array.from({ length: n }, (_, i) => ({ dir: 'in', at: now - ageDays * DAY - i })) })

describe('drawnLimit: every ring gets the same cut', () => {
  const crowd = Array.from({ length: 300 }, (_, i) => person('a' + i))
  it('300 acquaintances, default state -> 5 shown', () => {
    const lim = drawnLimit({ uiRings: undefined }, { membraneLimit: undefined }, 'acquaintance')
    expect(lim).toBe(5)
    const { shown, rest } = pickFive(crowd, { people: crowd }, lim, now)
    expect(shown.length).toBe(5)
    expect(rest.length).toBe(295)
  })
  it('the old default fill of acquaintances no longer bypasses; an explicit fill does', () => {
    expect(drawnLimit({ uiRings: { filled: ['friend'] } }, {}, 'acquaintance')).toBe(5)
    expect(drawnLimit({ uiRings: { filled: ['acquaintance'] } }, {}, 'acquaintance')).toBe(Infinity)
  })
  it('row unticked = everyone', () => {
    expect(drawnLimit({ uiRings: { perRingLimitOff: true } }, {}, 'close')).toBe(Infinity)
  })
})

describe('frequency / rankBy', () => {
  const a = person('a', { }), b = person('b'), c = person('c')
  const s = { people: [a, b, c], chats: { 'peer-a': msgs(2, 1), 'peer-b': msgs(5, 30), 'peer-c': msgs(5, 400) } }
  it('counts signals of the last 365 days', () => {
    expect(frequency(s, a, now)).toBe(2)
    expect(frequency(s, b, now)).toBe(5)
    expect(frequency(s, c, now)).toBe(0)
  })
  it('frequent ranks by count', () => {
    expect(rankedBy({ rankBy: 'frequent' }, s, [a, b, c], 3, now).shown.map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })
  it('tie -> recency', () => {
    const t = { people: [a, b], chats: { 'peer-a': msgs(2, 10), 'peer-b': msgs(2, 1) } }
    expect(rankedBy({ rankBy: 'frequent' }, t, [a, b], 2, now).shown.map((p) => p.id)).toEqual(['b', 'a'])
  })
  it('absent = recent, unchanged', () => {
    expect(rankedBy(undefined, s, [a, b, c], 3, now).shown.map((p) => p.id)).toEqual(pickFive([a, b, c], s, 3, now).shown.map((p) => p.id))
  })
})

describe('active chip', () => {
  it('"<m> per ring, most frequent"', () => {
    const f = activeFilters({ rankBy: 'frequent' }, [], [], 5)
    expect(f.map((x) => x.label)).toContain(S.perRingFrequentActive(5))
    expect(S.perRingFrequentActive(7)).toBe('7 per ring, most frequent')
  })
})
