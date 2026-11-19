// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 event-people-list: "People at this event" = hosts first, then who joins; > 15 -> first 10 + Show all. Fake data. */
import { PEOPLE_COLLAPSE_AT, PEOPLE_SHOWN, peopleAtEvent, visiblePeople } from '../../src/event_people_list.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], ...over })
const people = [P('b', 'Ben'), P('h', 'Hanna'), P('c', 'Cleo')]

describe('peopleAtEvent', () => {
  it('hosts first (a host with a card keeps its id, one without is name only), then who joins, once each', () => {
    expect(peopleAtEvent(people, ['Hanna'], [people[0], people[2]]).map((x) => [x.id, x.name, x.host])).toEqual([['h', 'Hanna', true], ['b', 'Ben', false], ['c', 'Cleo', false]])
    expect(peopleAtEvent([people[0]], ['Hanna'], [people[0]]).map((x) => [x.id ?? null, x.name, x.host])).toEqual([[null, 'Hanna', true], ['b', 'Ben', false]])
    expect(peopleAtEvent(people, ['Hanna'], [people[1], people[0]]).map((x) => x.name)).toEqual(['Hanna', 'Ben'])
  })
  it('a deleted host card or one seen only through a friend does not count as the host card', () => {
    expect(peopleAtEvent([P('h', 'Hanna', { deleted_at: 5 })], ['Hanna'], [])).toEqual([{ id: undefined, name: 'Hanna', host: true }])
    expect(peopleAtEvent([P('h', 'Hanna', { via: 'x' })], ['Hanna'], [])[0].id).toBeUndefined()
  })
})

describe('visiblePeople', () => {
  const n = (k) => Array.from({ length: k }, (_, i) => ({ name: `p${i}`, host: false }))
  it('up to 15 shows all; 16 or more shows the first 10 until Show all', () => {
    expect([PEOPLE_COLLAPSE_AT, PEOPLE_SHOWN]).toEqual([15, 10])
    expect(visiblePeople(n(15), false)).toHaveLength(15)
    expect(visiblePeople(n(16), false)).toHaveLength(10)
    expect(visiblePeople(n(16), true)).toHaveLength(16)
    expect(visiblePeople(n(40), false).map((x) => x.name)).toEqual(n(10).map((x) => x.name))
  })
})
