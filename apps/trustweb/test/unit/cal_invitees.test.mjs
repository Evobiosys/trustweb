// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar invitees (wave 24, cal2): pure helpers, the drag payload, and that invitees travel between own devices but never in a link. */
import { addInvitee, inviteText, invitees, removeInvitee } from '../../src/ext/calendar/invitees.ts'
import { EVENT_MIME, PERSON_MIME, decodeDrag, encodeDrag } from '../../src/drag_payload.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { bundleOf } from '../../src/sync_core.ts'

const ev = (extra = {}) => ({ id: 'e1', name: 'Fair', from: '2026-11-01', where: 'Graz', createdAt: 0, attended: true, ...extra })
const person = (id, name) => ({ id, name })

describe('invitees', () => {
  it('addInvitee adds once, absent list starts one', () => {
    const e = ev()
    addInvitee(e, 'a'); addInvitee(e, 'a'); addInvitee(e, 'b')
    expect(e.people).toEqual(['a', 'b'])
  })
  it('removeInvitee drops the id and the empty list', () => {
    const e = ev({ people: ['a'] })
    removeInvitee(e, 'a')
    expect(e.people).toBeUndefined()
  })
  it('invitees skips unknown ids', () => {
    const s = { people: [person('a', 'A')] }
    expect(invitees(s, ev({ people: ['x', 'a'] })).map((p) => p.id)).toEqual(['a'])
    expect(invitees(s, ev())).toEqual([])
  })
  it('inviteText holds the link and the event name', () => {
    const t = inviteText('https://x/#ev=1', 'Fair')
    expect(t).toContain('https://x/#ev=1')
    expect(t).toContain('Fair')
  })
})

describe('drag payload', () => {
  it('round-trips id and name only', () => {
    expect(decodeDrag(encodeDrag({ id: 'p1', name: 'Anna', secret: 'x' }))).toEqual({ id: 'p1', name: 'Anna' })
    expect(PERSON_MIME).toBe('text/x-trustweb-person')
    expect(EVENT_MIME).toBe('text/x-trustweb-event')
  })
  it('rejects junk, wrong shapes and over 512 chars', () => {
    for (const bad of ['', 'x', '[]', '{"id":1,"name":"a"}', '{"id":"a"}', JSON.stringify({ id: 'a', name: 'x'.repeat(600) }), 'null']) expect(decodeDrag(bad)).toBeNull()
  })
})

describe('invitees never leave in a link (I1), travel between own devices', () => {
  it('event link carries no person id', () => {
    const link = encodeEventLink(ev({ people: ['secret-person-id'] }), 'https://app.trustweb.one', 'peer')
    const raw = decodeURIComponent(escape(atob(link.split('#ev=')[1].replace(/-/g, '+').replace(/_/g, '/'))))
    expect(raw).not.toContain('secret-person-id')
    expect(raw).not.toContain('people')
  })
  it('sync bundle passes people through', () => {
    const s = { v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], events: [ev({ people: ['a'] })] }
    expect(bundleOf(s, {}).events[0].people).toEqual(['a'])
  })
})
