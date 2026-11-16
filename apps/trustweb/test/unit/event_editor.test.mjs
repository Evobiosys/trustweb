// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 event-editor: row order (Jakob item 12), fields <-> event, guest suggestions with @ and #, Family under Other groups, the compact variations. */
import { Ring } from '../../src/model.ts'
import { FAMILY_FIELD } from '../../src/rings_layout.ts'
import { EDITOR_ROWS, eventFromFields, fieldsOf, groupRows, guestRows } from '../../src/event_editor.ts'
import { emptyFields } from '../../src/event_draft.ts'
import { compactProfiles } from '../../src/more_features.ts'

const NOW = Date.parse('2026-11-16T10:00:00Z')
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: Ring.Friend, metAt: NOW, lines: [], ...extra })
const state = (extra = {}) => ({ v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [person('p1', 'Anna Gruber', { fields: { crew: 'true' } }), person('p2', 'Ben Huber', { fields: { crew: 'true' } }), person('p3', 'Clara Moser')], events: [], ...extra })
const TAGS = [{ id: 'crew', colour: '#a30', label: 'IYG Crew' }]

describe('editor rows (item 12: the calendar reference)', () => {
  it('name, time, guests, location, description, calendar, then everything else under Show more features', () => {
    expect(EDITOR_ROWS).toEqual(['name', 'time', 'guests', 'location', 'description', 'calendar', 'more'])
  })
})

describe('fields to event and back', () => {
  it('a new event: me as co-host, guests invited directly, details stored, defaults left out', () => {
    const s = state()
    const f = { ...emptyFields('2026-11-16', 'Jakob'), name: 'Picnic', from: '2026-12-01', where: 'Prater', guests: ['p1'], cohosts: ['Jakob', 'p2'], repeat: 'weekly', conference: [{ provider: 'jitsi', url: 'https://meet.jit.si/picnic' }], description: 'Bring food' }
    const ev = eventFromFields(s, f, { id: 'e9', now: NOW })
    expect(ev).toMatchObject({ id: 'e9', name: 'Picnic', from: '2026-12-01', where: 'Prater', people: ['p1'], hosts: ['Jakob', 'p2'], repeat: 'weekly', conference: [{ provider: 'jitsi' }], docs: { description: 'Bring food' }, attended: true })
    expect(ev.techSupport).toBeUndefined(); expect(ev.calendar).toBeUndefined(); expect(ev.attachment).toBeUndefined()
  })
  it('43-D7: the creator as technical support only is no host but tech support', () => {
    const f = { ...emptyFields('2026-11-16', 'Jakob'), name: 'Retreat', cohosts: ['Jakob', 'p2'], meRole: 'tech' }
    const ev = eventFromFields(state(), f, { id: 'e9', now: NOW })
    expect(ev.hosts).toEqual(['p2']); expect(ev.techSupport).toEqual(['Jakob'])
  })
  it('the first field that fails, in form order; a bad link fails as "link"', () => {
    expect(eventFromFields(state(), emptyFields('2026-11-16', 'J'), { id: 'x', now: NOW })).toBe('name')
    expect(eventFromFields(state(), { ...emptyFields('2026-11-16', 'J'), name: 'a', attachment: 'ftp://x' }, { id: 'x', now: NOW })).toBe('link')
  })
  it('editing keeps what the editor does not show (sign-up, settings) and drops what it cleared', () => {
    const existing = { id: 'e1', name: 'Old', from: '2026-12-01', to: '2026-12-03', where: '', createdAt: 5, attended: false, signup: ['me'], notify: false, repeat: 'daily', people: ['p1'] }
    const s = state({ events: [existing] })
    const f = { ...fieldsOf(s, existing), to: '', repeat: 'none', guests: [] }
    const ev = eventFromFields(s, f, { id: 'e1', now: NOW, existing })
    expect(ev).toMatchObject({ id: 'e1', createdAt: 5, attended: false, signup: ['me'], notify: false })
    expect(ev.to).toBeUndefined(); expect(ev.repeat).toBeUndefined(); expect(ev.people).toBeUndefined()
  })
  it('fieldsOf reads an event back: me as tech support, co-hosts without me', () => {
    const ev = { id: 'e1', name: 'R', from: '2026-12-01', where: 'W', createdAt: 0, attended: true, hosts: ['p2'], techSupport: ['Jakob'], people: ['p1'], repeat: 'monthly', themes: ['a', 'b'] }
    expect(fieldsOf(state(), ev)).toMatchObject({ name: 'R', meRole: 'tech', cohosts: ['p2'], guests: ['p1'], repeat: 'monthly', themes: 'a, b' })
  })
})

describe('guest suggestions: the same @ and # as elsewhere', () => {
  const s = state()
  it('plain text: people and tags; a tag row carries all its people (adding several at once)', () => {
    const rows = guestRows('cr', s.people, TAGS, [])
    expect(rows).toContainEqual({ kind: 'tag', id: 'crew', label: 'IYG Crew', ids: ['p1', 'p2'] })
  })
  it('@ = people only; # = tags only; already invited people are not offered', () => {
    expect(guestRows('@an', s.people, TAGS, ['p1']).map((r) => r.kind)).toEqual(['create'])
    expect(guestRows('@ben', s.people, TAGS, []).map((r) => r.kind)).toEqual(['person', 'create'])
    expect(guestRows('@ben', s.people, TAGS, [])[0]).toEqual({ kind: 'person', id: 'p2', label: 'Ben Huber' })
    expect(guestRows('#iyg', s.people, TAGS, ['p1'])).toEqual([{ kind: 'tag', id: 'crew', label: 'IYG Crew', ids: ['p2'] }])
  })
  it('a new name offers "add as a new person"; nothing typed offers nothing', () => {
    expect(guestRows('Dora Neu', s.people, TAGS, []).at(-1)).toEqual({ kind: 'create', label: 'Dora Neu' })
    expect(guestRows('ben huber', s.people, TAGS, []).some((r) => r.kind === 'create')).toBe(false)
    expect(guestRows('  ', s.people, TAGS, [])).toEqual([])
  })
})

describe('groups (item 11)', () => {
  it('Family is not a community: it sits under Other groups', () => {
    const g = groupRows([{ id: 'crew', name: 'IYG Crew' }, { id: FAMILY_FIELD, name: 'family' }])
    expect(g.communities.map((r) => r.id)).toEqual(['crew'])
    expect(g.others.map((r) => r.id)).toEqual([FAMILY_FIELD])
  })
})

describe('Show more features (item 9)', () => {
  it('the compact variations leave out Reader and Note taker (they live in "change bottom row") unless one is in force', () => {
    expect(compactProfiles('full').map((p) => p.id)).toEqual(['full', 'iyg-support'])
    expect(compactProfiles('reader').map((p) => p.id)).toEqual(['full', 'iyg-support', 'reader'])
  })
})
