// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: "Invited to" (src/invitations.ts): the form, grouping by place, the card line, the pasted list, event-like rows. */
import {
  INVITATION_STATUSES, groupByPlace, invitationEventRows, invitationsOfHost, newInvitation, parseInvitationList, mergeEventRows,
} from '../../src/invitations.ts'

const people = [{ id: 'p1', name: 'Yana Roth' }, { id: 'p2', name: 'Danilo' }]
const inv = (id, extra = {}) => ({ id, kind: 'invitation', status: 'open', ...extra })

describe('newInvitation', () => {
  it('needs a place, an event or a host', () => {
    expect(newInvitation({}, 'a')).toBe('empty')
    expect(newInvitation({ place: '  ', event: '' }, 'a')).toBe('empty')
  })
  it('trims, drops empty fields and defaults the status to open', () => {
    expect(newInvitation({ place: ' Sonoma ', host: 'p1', date: '', link: '', note: ' ' }, 'a')).toEqual({ id: 'a', kind: 'invitation', place: 'Sonoma', host: 'p1', status: 'open' })
  })
  it('rejects a bad date and an unknown status', () => {
    expect(newInvitation({ place: 'x', date: '12.3.' }, 'a')).toBe('date')
    expect(newInvitation({ place: 'x', status: 'maybe' }, 'a')).toBe('status')
    expect(INVITATION_STATUSES).toEqual(['open', 'accepted', 'declined', 'past'])
  })
})

describe('groupByPlace', () => {
  it('groups by place in first-seen order, no-place last, dated before undated inside a group', () => {
    const list = [inv('a', { place: 'Brazil' }), inv('b'), inv('c', { place: 'brazil', date: '2027-01-02' }), inv('d', { place: 'Sonoma' })]
    const g = groupByPlace(list)
    expect(g.map((x) => x.place)).toEqual(['Brazil', 'Sonoma', ''])
    expect(g[0].items.map((i) => i.id)).toEqual(['c', 'a'])
  })
})

describe('invitationsOfHost', () => {
  it('lists the invitations whose host is the person', () => {
    const s = { invitations: [inv('a', { host: 'p1' }), inv('b', { host: 'p2' }), inv('c')] }
    expect(invitationsOfHost(s, 'p1').map((i) => i.id)).toEqual(['a'])
    expect(invitationsOfHost({}, 'p1')).toEqual([])
  })
})

describe('parseInvitationList', () => {
  const ids = (() => { let n = 0; return () => 'n' + ++n })()
  it('reads "Place: Person, Person"; a known person becomes the host, any other name the event label', () => {
    const out = parseInvitationList('Sonoma: Yana Roth\nSan Francisco: Day, Capital Institute person\n\nBrazil: danilo', people, ids)
    expect(out.map((i) => [i.place, i.host, i.event])).toEqual([
      ['Sonoma', 'p1', undefined], ['San Francisco', undefined, 'Day'], ['San Francisco', undefined, 'Capital Institute person'], ['Brazil', 'p2', undefined],
    ])
    expect(out.every((i) => i.kind === 'invitation' && i.status === 'open')).toBe(true)
  })
  it('a line without a colon is a place alone; blank lines are skipped', () => {
    expect(parseInvitationList('Lisbon\n\n', people, ids).map((i) => [i.place, i.host, i.event])).toEqual([['Lisbon', undefined, undefined]])
  })
})

describe('event-like rows', () => {
  const s = { people, invitations: [inv('a', { place: 'Sonoma', host: 'p1' }), inv('b', { place: 'San Francisco', event: 'Day', date: '2027-03-01' }), inv('c', { place: 'Brazil', host: 'p2', date: '2026-12-01' })] }
  it('match by place, event or host name like events do', () => {
    expect(invitationEventRows(s, 'san fr').map((r) => r.id)).toEqual(['b'])
    expect(invitationEventRows(s, 'yana').map((r) => r.id)).toEqual(['a'])
  })
  it('an empty query gives all; dated sort first by date, undated last; each is tagged invitation', () => {
    const rows = invitationEventRows(s, '')
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(rows.every((r) => r.tag === 'invitation')).toBe(true)
    expect(rows[2]).toMatchObject({ name: 'Yana Roth', where: 'Sonoma', from: '' })
  })
  it('declined invitations stay out of the rows', () => {
    expect(invitationEventRows({ people, invitations: [inv('x', { place: 'Oslo', status: 'declined' })] }, '')).toEqual([])
  })
  it('mergeEventRows puts the invitation rows after the events and keeps events first', () => {
    const rows = invitationEventRows(s, '')
    expect(mergeEventRows([{ id: 'e' }], rows).map((r) => r.id)).toEqual(['e', 'c', 'b', 'a'])
  })
})
