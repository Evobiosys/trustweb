// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { peopleByZone, pinnedPeople, lastContact } from '../../src/people_list'
import { Ring } from '../../src/model'

const DAY = 86_400_000
const p = (id, name, ring, metAt, extra = {}) => ({ id, name, context: '', ring, metAt, lines: [], ...extra })

describe('people list by trust zone', () => {
  const people = [
    p('a', 'Ada', Ring.Closest, 1 * DAY),
    p('b', 'Ben', Ring.Close, 2 * DAY),
    p('c', 'Cem', Ring.Close, 3 * DAY, { timeline: [{ at: 9 * DAY }] }),
    p('d', 'Dora', Ring.Intending, 4 * DAY),
    p('e', 'Eli', Ring.Unsorted, 5 * DAY),
  ]
  it('groups in ladder order, empty zones left out, unplaced last', () => {
    expect(peopleByZone({ people }, '').map((g) => g.ring)).toEqual([Ring.Closest, Ring.Close, Ring.Intending, Ring.Unsorted])
  })
  it('sorts inside a zone by latest contact, newest first', () => {
    expect(peopleByZone({ people }, '')[1].people.map((x) => x.id)).toEqual(['c', 'b'])
  })
  it('latest contact is the newest of chat, timeline, kept tie and the day we met', () => {
    const q = p('q', 'Q', Ring.Close, 1, { peerId: 'x', engagementKept: 50 })
    expect(lastContact({ chats: { x: { messages: [{ at: 70 }] } } }, q)).toBe(70)
    expect(lastContact({}, q)).toBe(50)
    expect(lastContact({}, p('r', 'R', Ring.Close, 7))).toBe(7)
  })
  it('a search keeps only matching names or contexts, case-blind', () => {
    const g = peopleByZone({ people: [...people, p('f', 'Fay', Ring.Friend, 1, { context: 'Repair café' })] }, 'REPAIR')
    expect(g.map((x) => x.people.map((y) => y.id))).toEqual([['f']])
  })
  it('pinned people form their own group, newest first, and are not repeated in their zones', () => {
    const all = [...people, p('g', 'Gus', Ring.Close, 1, { pinned: true }), p('h', 'Hal', Ring.Closest, 6 * DAY, { pinned: true })]
    expect(pinnedPeople({ people: all }, '').map((x) => x.id)).toEqual(['h', 'g'])
    const ids = peopleByZone({ people: all }, '').flatMap((g) => g.people.map((x) => x.id))
    expect(ids).not.toContain('g'); expect(ids).not.toContain('h')
    expect(new Set([...ids, 'g', 'h']).size).toBe(all.length)
  })
  it('no pinned people, no pinned group; a search filters it too', () => {
    expect(pinnedPeople({ people }, '')).toEqual([])
    expect(pinnedPeople({ people: [p('g', 'Gus', Ring.Close, 1, { pinned: true })] }, 'zzz')).toEqual([])
  })
})
