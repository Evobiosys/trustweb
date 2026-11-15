// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 web-focus-filter: an event as a Web filter (pure parts): tag helpers, the `event:` chip, labels, the Back state, clear all. */
import { eventTagLabel, eventTagSlug } from '../../src/events.ts'
import { filterByChips } from '../../src/tag_filter.ts'
import { activeFilters } from '../../src/filter_active.ts'
import { BADGE_PRESS, clearFilters, eventChip, filterCount, focusEvent, focusPop, focusState } from '../../src/web_focus.ts'

const ev = { id: 'e1', name: 'Winter IYG', roles: [{ name: 'Cook', who: 'c' }, { name: 'DJ', who: 'me' }, { name: 'Door' }] }
const p = (id, events) => ({ id, name: id.toUpperCase(), ring: 'friend', fields: {}, ...(events ? { events } : {}) })
const people = [p('a', ['e1']), p('b'), p('c'), p('d', ['e2']), p('e', ['e2', 'e1'])]
const ids = (r) => r.map((x) => x.id)

describe('event tag helpers (P4)', () => {
  it('slug: keeps case, spaces to underscore, other punctuation stripped', () => {
    expect(eventTagSlug('Winter IYG')).toBe('event_Winter_IYG')
    expect(eventTagSlug('  Sommer-Fest, 2026!  ')).toBe('event_SommerFest_2026')
    expect(eventTagSlug('Über  uns')).toBe('event_Über_uns')
  })
  it('label: #event:<name>', () => expect(eventTagLabel('Winter IYG')).toBe('#event:Winter IYG'))
})

describe('the event chip', () => {
  it('chip is event:<id>', () => expect(eventChip('e1')).toBe('event:e1'))
  it('shows the tagged people and the role holders, nobody else', () => {
    expect(ids(filterByChips(people, [], ['event:e1'], [], [ev]))).toEqual(['a', 'c', 'e'])
  })
  it('without the event list the tagged people still match', () => expect(ids(filterByChips(people, [], ['event:e1'], []))).toEqual(['a', 'e']))
  it('hide wins and adds up with other chips', () => {
    expect(ids(filterByChips(people, [], ['event:e1'], ['person:a'], [ev]))).toEqual(['c', 'e'])
    expect(ids(filterByChips(people, [], ['event:e1', 'person:b'], [], [ev]))).toEqual(['a', 'b', 'c', 'e'])
  })
})

describe('the filter list', () => {
  it('names the event chip #event:<name> and still lists it when the event is gone', () => {
    expect(activeFilters({ show: ['event:e1'] }, [], [], undefined, [ev])).toEqual([{ chip: 'event:e1', label: 'Only #event:Winter IYG' }])
    expect(activeFilters({ hide: ['event:zz'] }, [], [], undefined, [ev])[0].label).toBe('Hide #event:zz')
  })
  it('the device tag name wins over the event name', () => {
    expect(activeFilters({ show: ['event:e1'] }, [], [], undefined, [{ ...ev, tagName: 'IYG' }])[0].label).toBe('Only #event:IYG')
  })
})

describe('focusing an event', () => {
  it('sets exactly the event chip (one filter) and leaves other ui settings', () => {
    const s = { uiRings: { show: ['tag:x'], hide: ['person:q'], sidebarOpen: false }, events: [ev] }
    focusEvent(s, 'e1')
    expect(s.uiRings).toEqual({ show: ['event:e1'], hide: [], sidebarOpen: false })
    expect(filterCount(s)).toBe(1)
  })
  it('clearFilters drops every filter, the badge count is 0', () => {
    const s = { uiRings: { show: ['event:e1'], hide: ['tag:x'], closest150: true, rankBy: 'frequent' }, membraneLimit: 3 }
    clearFilters(s)
    expect(s.uiRings.show).toEqual([])
    expect(s.uiRings.hide).toEqual([])
    expect(s.uiRings.closest150).toBe(false)
    expect(s.uiRings.rankBy).toBeUndefined()
    expect(s.membraneLimit).toBeUndefined()
    expect(filterCount(s)).toBe(0)
  })
  it('the badge opens the list by default (one-line switch: clear)', () => expect(BADGE_PRESS).toBe('list'))
})

describe('Back from the focused Web', () => {
  it('the pushed state names the event', () => expect(focusState('e1')).toEqual({ twFocus: 'e1' }))
  it('Back (a state without twFocus) returns the event to open; staying on a focus state does not', () => {
    expect(focusPop(null, 'e1')).toBe('e1')
    expect(focusPop({ twPage: 'card' }, 'e1')).toBeNull()
    expect(focusPop({ twFocus: 'e1' }, 'e1')).toBeNull()
    expect(focusPop(null, null)).toBeNull()
  })
})
