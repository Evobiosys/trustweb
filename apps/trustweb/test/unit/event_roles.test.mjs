// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-roles: organizers / hosts / tech support lists, the legacy organizer migration, the identify-a-person logic, event tag helpers. */
import { Ring } from '../../src/model.ts'
import { eventTagLabel, eventTagSlug, newEvent } from '../../src/events.ts'
import { NEW_FROM_EVENT_RING, eventForLink, eventOrganizers, identifyPerson, migrateEventRoles, refsForNames, relatedOthers, roleLabels, rolesSummary, setRoles } from '../../src/event_roles.ts'
import { identifyRows } from '../../src/event_person_picker.ts'
import { migrate } from '../../src/schema_version.ts'

const NOW = 1_700_000_000_000
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: Ring.Friend, metAt: NOW, lines: [], ...extra })
const ev = (extra = {}) => ({ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: NOW, attended: true, ...extra })
const state = (extra = {}) => ({ v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false, inventory: [], people: [person('p1', 'Anna Gruber'), person('p2', 'Ben Huber')], events: [ev()], ...extra })

describe('event tag helpers (P4)', () => {
  it('slug: lowercase, spaces to underscore, other punctuation stripped, prefixed event_', () => {
    expect(eventTagSlug('Winter IYG')).toBe('event_Winter_IYG')
    expect(eventTagSlug('  Forum  Alpbach: 2026! ')).toBe('event_Forum_Alpbach_2026')
    expect(eventTagSlug('Fête de l’été')).toBe('event_Fête_de_lété')
  })
  it('label: #event:<name>', () => expect(eventTagLabel('Winter IYG')).toBe('#event:Winter IYG'))
})

describe('roles model', () => {
  it('newEvent keeps organizers and techSupport trimmed, leaves empties out, and keeps the legacy organizer text as one organizer', () => {
    const made = newEvent({ name: 'A', from: '2026-10-12', where: '', organizers: [' Ada ', ''], techSupport: ['t1'] }, 'x', NOW)
    expect(made).toMatchObject({ organizers: ['Ada'], techSupport: ['t1'] })
    expect(made.hosts).toBeUndefined()
    expect(newEvent({ name: 'A', from: '2026-10-12', where: '', organizer: ' Verein X ' }, 'x', NOW)).toMatchObject({ organizers: ['Verein X'], organizer: 'Verein X' })
  })
  it('migration: legacy organizer becomes organizers once; a second run changes nothing', () => {
    const s = state({ events: [ev({ organizer: 'Verein X' }), ev({ id: 'e2', organizers: ['p1'], organizer: 'old' }), ev({ id: 'e3' })] })
    expect(migrateEventRoles(s)).toBe(true)
    expect(s.events.map((e) => e.organizers)).toEqual([['Verein X'], ['p1'], undefined])
    expect(s.events[0].organizer).toBe('Verein X')
    expect(migrateEventRoles(s)).toBe(false)
  })
  it('migration runs inside the record migrate chain', () => {
    const s = state({ events: [ev({ organizer: 'Verein X' })] })
    migrate(s)
    expect(s.events[0].organizers).toEqual(['Verein X'])
  })
  it('eventOrganizers reads organizers, else the legacy text', () => {
    expect(eventOrganizers(ev({ organizers: ['p1'] }))).toEqual(['p1'])
    expect(eventOrganizers(ev({ organizer: 'Verein X' }))).toEqual(['Verein X'])
    expect(eventOrganizers(ev())).toEqual([])
  })
  it('setRoles stores the three lists (trimmed, no empties, no repeats) and keeps the legacy text in step with names', () => {
    const s = state()
    const e = s.events[0]
    setRoles(s, e, { organizers: ['p1', ' Ada ', 'p1'], hosts: ['p2'], techSupport: [] })
    expect(e.organizers).toEqual(['p1', 'Ada'])
    expect(e.hosts).toEqual(['p2'])
    expect(e.techSupport).toBeUndefined()
    expect(e.organizer).toBe('Anna Gruber, Ada')
    setRoles(s, e, { organizers: [] })
    expect(e.organizers).toBeUndefined()
    expect(e.organizer).toBeUndefined()
    expect(e.hosts).toEqual(['p2'])
  })
  it('roleLabels shows a person id as the name, a free name as typed; rolesSummary joins them or is empty', () => {
    const s = state()
    expect(roleLabels(s, ['p1', 'Ada', 'gone'])).toEqual(['Anna Gruber', 'Ada', 'gone'])
    expect(rolesSummary(s, ev({ organizers: ['p1', 'p2'] }))).toBe('Anna Gruber, Ben Huber')
    expect(rolesSummary(s, ev())).toBe('')
  })
  it('refsForNames: a shown name goes back to its person id, a new one stays a free name', () => {
    const s = state()
    expect(refsForNames(s, ['Anna Gruber', ' Ada ', ''], ['p1', 'Ada0'])).toEqual(['p1', 'Ada'])
  })
  it('eventForLink hands over names, never person ids', () => {
    const s = state()
    const out = eventForLink(s, ev({ organizers: ['p1'], hosts: ['p2', 'Ada'], techSupport: ['p1'] }))
    expect(out).toMatchObject({ organizer: 'Anna Gruber', hosts: ['Ben Huber', 'Ada'] })
    expect(out.techSupport).toBeUndefined()
    expect(out.organizers).toBeUndefined()
  })
  it('relatedOthers: people only via roles or invitations, not the tagged ones', () => {
    const s = state({ people: [person('p1', 'A', { events: ['e1'] }), person('p2', 'B'), person('p3', 'C'), person('p4', 'D')] })
    const e = ev({ organizers: ['p1', 'p2'], hosts: ['Free Name'], techSupport: ['p3'], people: ['p4', 'p2'] })
    expect(relatedOthers(s, e).map((p) => p.id)).toEqual(['p2', 'p3', 'p4'])
  })
})

describe('identify a person', () => {
  it('rows: matches first, the create row last when no exact name exists', () => {
    const s = state()
    expect(identifyRows(s.people, 'Anna')).toEqual([s.people[0], { create: 'Anna' }])
    expect(identifyRows(s.people, 'Anna Zeta').at(-1)).toEqual({ create: 'Anna Zeta' })
    expect(identifyRows(s.people, '')).toEqual(s.people)
  })
  it('rows: an exact name (any case, spaces) offers no create row', () => {
    expect(identifyRows(state().people, '  anna gruber ').some((r) => 'create' in r)).toBe(false)
  })
  it('rows: an excluded person is not offered, yet their exact name still blocks a duplicate', () => {
    const s = state()
    expect(identifyRows(s.people, 'Anna Gruber', ['p1'])).toEqual([])
    expect(identifyRows(s.people, 'Anna', ['p1'])).toEqual([{ create: 'Anna' }])
  })
  it('rows leave out deleted people', () => {
    const people = [person('p1', 'Anna Gruber', { deleted_at: '2026-11-01' })]
    expect(identifyRows(people, 'Anna Gruber')).toEqual([{ create: 'Anna Gruber' }])
  })
  it('matches an existing person case-insensitively: no duplicate, not tagged unless asked', () => {
    const s = state()
    expect(identifyPerson(s, 'e1', ' ANNA gruber ', { id: 'n1', now: NOW })).toEqual({ personId: 'p1', created: false })
    expect(s.people).toHaveLength(2)
    expect(s.people[0].events).toBeUndefined()
    expect(identifyPerson(s, 'e1', 'Ben Huber', { id: 'n1', now: NOW, tag: true })).toEqual({ personId: 'p2', created: false })
    expect(s.people[1].events).toEqual(['e1'])
  })
  it('creates a new person in the ring constant, tagged with the event', () => {
    const s = state()
    expect(NEW_FROM_EVENT_RING).toBe(Ring.Unsorted)
    expect(identifyPerson(s, 'e1', ' Cleo Neu ', { id: 'n1', now: NOW })).toEqual({ personId: 'n1', created: true })
    expect(s.people.at(-1)).toMatchObject({ id: 'n1', name: 'Cleo Neu', ring: Ring.Unsorted, events: ['e1'], metAt: NOW })
    expect(identifyPerson(s, 'e1', 'cleo neu', { id: 'n2', now: NOW })).toEqual({ personId: 'n1', created: false })
    expect(s.people).toHaveLength(3)
  })
  it('the ring can be chosen by the caller (pickRing path)', () => {
    const s = state()
    identifyPerson(s, 'e1', 'Dora', { id: 'n1', now: NOW, ring: Ring.Acquaintance })
    expect(s.people.at(-1).ring).toBe(Ring.Acquaintance)
  })
  it('an empty name does nothing', () => {
    const s = state()
    expect(identifyPerson(s, 'e1', '  ', { id: 'n1', now: NOW })).toBeUndefined()
    expect(s.people).toHaveLength(2)
  })
})

describe('community and events cards show a role as a name', () => {
  it('buildEvents: the host is the first host, else the first organizer; a person id shows as the name', async () => {
    const { buildEvents } = await import('../../src/ext/community-mighty/community_model.ts')
    const people = [{ id: 'p1', name: 'Anna Gruber' }]
    const card = (extra) => buildEvents([ev(extra)], NOW, people)[0].host
    expect(card({ hosts: ['p1'] })).toBe('Anna Gruber')
    expect(card({ organizers: ['p1'] })).toBe('Anna Gruber')
    expect(card({ organizer: 'Verein X' })).toBe('Verein X')
    expect(card({})).toBeUndefined()
  })
})
