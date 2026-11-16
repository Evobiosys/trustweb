// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b filters-communities (item 4): EVENT MODE, a filter mode beside community mode (event_mode.ts is the event-only app variant, a different thing). */
import { eventFilterOf, eventModePill, eventModeShow, narrowToEvent, setEventFilter } from '../../src/event_filter_mode.ts'

const events = [{ id: 'e1', name: 'Winter IYG', roles: [{ who: 'x', role: 'cook' }] }, { id: 'e2', name: 'Other' }]
const people = [{ id: 'a', name: 'a', ring: 'friend', events: ['e1'] }, { id: 'b', name: 'b', ring: 'friend' }, { id: 'x', name: 'x', ring: 'friend' }]

describe('event filter mode', () => {
  it('off by default; set and leave', () => {
    const s = {}
    expect(eventFilterOf(s)).toBeNull()
    expect(setEventFilter(s, 'e1')).toBe(true)
    expect(eventFilterOf(s)).toBe('e1')
    expect(setEventFilter(s, 'e1')).toBe(false)
    setEventFilter(s, null)
    expect(eventFilterOf(s)).toBeNull()
    expect(s.uiRings.eventMode).toBeUndefined()
  })
  it('the Web show list gains the event chip while the mode is on', () => {
    expect(eventModeShow({ uiRings: { show: ['tag:a'], eventMode: 'e1' } })).toEqual(['tag:a', 'event:e1'])
    expect(eventModeShow({ uiRings: { show: ['tag:a'] } })).toEqual(['tag:a'])
    expect(eventModeShow({ uiRings: { show: ['event:e1'], eventMode: 'e1' } })).toEqual(['event:e1'])
  })
  it('narrowToEvent keeps only the people connected with the event (tag or role); mode off: everyone', () => {
    const s = { uiRings: { eventMode: 'e1' }, events }
    expect(narrowToEvent(s, people).map((p) => p.id)).toEqual(['a', 'x'])
    expect(narrowToEvent({ uiRings: {}, events }, people)).toHaveLength(3)
  })
  it('the pill reads #event:<name>; null when off or the event is gone', () => {
    expect(eventModePill({ uiRings: { eventMode: 'e1' }, events })).toBe('#event:Winter IYG')
    expect(eventModePill({ uiRings: {}, events })).toBeNull()
    expect(eventModePill({ uiRings: { eventMode: 'zz' }, events })).toBeNull()
  })
})

import { narrowById, narrowMatches } from '../../src/event_filter_mode.ts'
import { allowedPeerIds } from '../../src/ask_audience.ts'

describe('Chat, Resources and Ask under event mode', () => {
  const s = { uiRings: { eventMode: 'e1' }, events, people: people.map((p) => ({ ...p, peerId: 'peer-' + p.id })) }
  it('chat rows keep only the event people', () => expect(narrowById(s, [{ id: 'a' }, { id: 'b' }, { id: 'x' }]).map((r) => r.id)).toEqual(['a', 'x']))
  it('matches keep only the event people; community-only matches go', () => {
    const m = [{ personId: 'a' }, { personId: 'b' }, { communityId: 'c' }]
    expect(narrowMatches(s, m)).toEqual([{ personId: 'a' }])
    expect(narrowMatches({ ...s, uiRings: {} }, m)).toHaveLength(3)
  })
  it('Ask reaches only the event people; with its own audience filter, the overlap', () => {
    expect(allowedPeerIds(s, []).sort()).toEqual(['peer-a', 'peer-x'])
    expect(allowedPeerIds({ ...s, uiRings: {} }, [])).toBeNull()
    expect(allowedPeerIds({ ...s, askAudience: { add: [], exclude: ['person:x'] } }, [])).toEqual(['peer-a'])
  })
})
