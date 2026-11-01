// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 pin-order (membranes_five.ts pinnedOrder, togglePin): pinned people by pin time (default) or by latest contact. */
import { Ring } from '../../src/model.ts'
import { pinnedOrder, pinnedModeOf, togglePin, pickFive, wholeZone } from '../../src/membranes_five.ts'
import { peopleByZone, pinnedPeople } from '../../src/people_list.ts'

const person = (id, o = {}) => ({ id, name: id, context: '', ring: Ring.Friend, metAt: 0, ...o })
const at = (p) => p.metAt
const ids = (l) => l.map((p) => p.id)
const a = person('a', { metAt: 300, pinned: true, pinnedAt: 10 })
const b = person('b', { metAt: 100, pinned: true, pinnedAt: 20 })
const c = person('c', { metAt: 200, pinned: true })
const d = person('d', { metAt: 900 })

describe('pinnedOrder', () => {
  it('"pinned": newest pin first, no pinnedAt = oldest (then latest contact), unpinned after by contact', () => {
    expect(ids(pinnedOrder([d, c, a, b], 'pinned', at))).toEqual(['b', 'a', 'c', 'd'])
  })
  it('"contact": pinned by latest contact, ignoring pinnedAt', () => {
    expect(ids(pinnedOrder([d, c, a, b], 'contact', at))).toEqual(['a', 'c', 'b', 'd'])
  })
  it('ties keep a stable order by id and the input is not changed', () => {
    const l = [person('z', { pinned: true }), person('y', { pinned: true })]
    expect(ids(pinnedOrder(l, 'pinned', at))).toEqual(['y', 'z'])
    expect(ids(l)).toEqual(['z', 'y'])
  })
})

describe('pinnedModeOf', () => {
  it('absent or junk = pinned; only "contact" switches', () => {
    expect(pinnedModeOf({})).toBe('pinned'); expect(pinnedModeOf({ pinnedOrder: 'x' })).toBe('pinned')
    expect(pinnedModeOf({ pinnedOrder: 'contact' })).toBe('contact')
  })
})

describe('togglePin', () => {
  it('pinning stamps the time; unpinning drops flag and stamp', () => {
    const p = person('p')
    togglePin(p, 77); expect(p).toMatchObject({ pinned: true, pinnedAt: 77 })
    togglePin(p, 88); expect('pinned' in p).toBe(false); expect('pinnedAt' in p).toBe(false)
  })
})

describe('the setting reaches the lists', () => {
  const people = [a, b, c, d]
  it('pickFive, wholeZone and the people list follow s.pinnedOrder', () => {
    expect(ids(wholeZone(people, {}, 0))).toEqual(['b', 'a', 'c', 'd'])
    expect(ids(wholeZone(people, { pinnedOrder: 'contact' }, 0))).toEqual(['a', 'c', 'b', 'd'])
    expect(ids(pickFive(people, { pinnedOrder: 'contact' }, 2, 0).shown)).toEqual(['a', 'c'])
    expect(ids(pinnedPeople({ people }, ''))).toEqual(['b', 'a', 'c'])
    expect(ids(pinnedPeople({ people, pinnedOrder: 'contact' }, ''))).toEqual(['a', 'c', 'b'])
    expect(peopleByZone({ people }, '').flatMap((g) => ids(g.people))).toEqual(['d'])
  })
})
