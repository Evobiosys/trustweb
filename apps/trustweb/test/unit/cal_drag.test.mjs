// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar drag and drop (wave 24, cal7): an event onto Resources, a person onto an event, unknown ids add nothing. */
import { eventDropItem } from '../../src/event_drop.ts'
import { personDropOnEvent } from '../../src/ext/calendar/invitees.ts'
import { EVENT_MIME, PERSON_MIME, decodeDrag, encodeDrag } from '../../src/drag_payload.ts'
import { Audience } from '../../src/model.ts'

const ev = { id: 'e1', name: 'Fair', from: '2026-11-01', where: 'Graz', createdAt: 0, attended: true }
const state = (extra = {}) => ({ events: [{ ...ev }], people: [{ id: 'p1', name: 'Ana' }], ...extra })

describe('eventDropItem', () => {
  it('makes an item with the event label, tagged, with the typed-item defaults', () => {
    const it = eventDropItem(state(), { id: 'e1', name: 'x' }, 'i1', 5)
    expect(it).toMatchObject({ id: 'i1', text: 'Fair · 1 Nov 2026, Graz', eventId: 'e1', audience: Audience.FriendsOfFriends, included: true, createdAt: 5 })
  })
  it('null for an event id not in this record, or no events at all', () => {
    expect(eventDropItem(state(), { id: 'zz', name: 'Fair' }, 'i1', 5)).toBeNull()
    expect(eventDropItem({ people: [] }, { id: 'e1', name: 'Fair' }, 'i1', 5)).toBeNull()
  })
})

describe('personDropOnEvent', () => {
  it('invites a known person once', () => {
    const s = state(), e = s.events[0]
    expect(personDropOnEvent(s, e, { id: 'p1', name: 'Ana' })).toBe(true)
    expect(e.people).toEqual(['p1'])
  })
  it('adds nothing for a person of another record', () => {
    const s = state(), e = s.events[0]
    expect(personDropOnEvent(s, e, { id: 'zz', name: 'Bo' })).toBe(false)
    expect(e.people).toBeUndefined()
  })
})

describe('event payload', () => {
  it('uses its own type and round-trips', () => {
    expect(EVENT_MIME).not.toBe(PERSON_MIME)
    expect(decodeDrag(encodeDrag({ id: 'e1', name: 'Fair' }))).toEqual({ id: 'e1', name: 'Fair' })
    expect(decodeDrag('{"id":1,"name":"x"}')).toBeNull()
  })
})
