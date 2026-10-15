/** Events (E1, wave 7): the model, the per-event tag on a person, and that nothing of it leaves the phone. */
import { Audience, LineStatus, Ring, Tag } from '../../src/model.ts'
import { askSources } from '../../src/cascade.ts'
import { attendees, deleteEvent, eventLabel, localSettings, tagLabel, eventsSorted, isPast, matchPeople, newEvent, restoreEvent, splitThemes, tagPerson, untagPerson, whenLabel } from '../../src/events.ts'

const NOW = new Date('2026-10-15T12:00').getTime()
const ev = (over = {}) => newEvent({ name: 'Forum Alpbach', from: '2026-10-12', where: 'Vienna', ...over }, over.id ?? 'e1', NOW)
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: Ring.Friend, metAt: NOW, lines: [], ...extra })
const state = (extra = {}) => ({ v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false, inventory: [], people: [person('p1', 'Anna Gruber'), person('p2', 'Ben Huber')], ...extra })

describe('newEvent', () => {
  it('name, from and where are mandatory, in form order', () => {
    expect(newEvent({ name: ' ', from: '', where: '' }, 'x', NOW)).toBe('name')
    expect(newEvent({ name: 'A', from: '', where: 'B' }, 'x', NOW)).toBe('from')
    expect(newEvent({ name: 'A', from: '2026-13-40', where: 'B' }, 'x', NOW)).toBe('from')
    expect(newEvent({ name: 'A', from: '2026-10-12', where: ' ' }, 'x', NOW)).toBe('where')
  })
  it('to may not be before from; a date-only end lasts the whole day', () => {
    expect(ev({ to: '2026-10-11' })).toBe('to')
    expect(ev({ to: 'soon' })).toBe('to')
    expect(ev({ from: '2026-10-12T18:00', to: '2026-10-12' })).toMatchObject({ to: '2026-10-12' })
    expect(ev({ from: '2026-10-12T18:00', to: '2026-10-12T17:00' })).toBe('to')
  })
  it('keeps what is given, trimmed, and leaves empty optionals out; I attended by default', () => {
    expect(ev({ conditions: ' ', themes: [], organizer: '' })).toEqual({ id: 'e1', name: 'Forum Alpbach', from: '2026-10-12', where: 'Vienna', createdAt: NOW, attended: true })
    expect(ev({ themes: ['trust', ' '], organizer: ' Verein X ', attended: false })).toMatchObject({ themes: ['trust'], organizer: 'Verein X', attended: false })
  })
  it('splitThemes: comma separated, trimmed, no empties or repeats', () => expect(splitThemes('trust, ,commons,trust')).toEqual(['trust', 'commons']))
})

describe('eventsSorted / isPast', () => {
  const a = ev({ id: 'a', from: '2026-10-20' })
  const b = ev({ id: 'b', from: '2026-11-01' })
  const c = ev({ id: 'c', from: '2026-10-01' })
  const d = ev({ id: 'd', from: '2026-10-10', to: '2026-10-15' })
  it('upcoming soonest first, then past latest first; a multi-day event running today is upcoming', () => {
    const r = eventsSorted(state({ events: [c, b, a, d] }), NOW)
    expect(r.upcoming.map((e) => e.id)).toEqual(['d', 'a', 'b'])
    expect(r.past.map((e) => e.id)).toEqual(['c'])
  })
  it('no events: both empty', () => expect(eventsSorted(state(), NOW)).toEqual({ upcoming: [], past: [] }))
  it('isPast', () => { expect(isPast(c, NOW)).toBe(true); expect(isPast(a, NOW)).toBe(false) })
})

describe('tags', () => {
  it('tag is idempotent, attendees lists the tagged, untag removes the field when empty', () => {
    const s = state({ events: [ev()] })
    tagPerson(s, 'p1', 'e1'); tagPerson(s, 'p1', 'e1'); tagPerson(s, 'p2', 'e1')
    expect(s.people[0].events).toEqual(['e1'])
    expect(attendees(s, 'e1').map((p) => p.id)).toEqual(['p1', 'p2'])
    untagPerson(s, 'p1', 'e1')
    expect('events' in s.people[0]).toBe(false)
    tagPerson(s, 'nobody', 'e1')
    expect(attendees(s, 'e1').map((p) => p.id)).toEqual(['p2'])
  })
  it('deleteEvent removes the tags and restoreEvent puts both back', () => {
    const s = state({ events: [ev()] })
    tagPerson(s, 'p2', 'e1')
    const gone = deleteEvent(s, 'e1')
    expect(s.events).toEqual([])
    expect(s.people[1].events).toBeUndefined()
    restoreEvent(s, gone)
    expect(s.events.map((e) => e.id)).toEqual(['e1'])
    expect(s.people[1].events).toEqual(['e1'])
    expect(deleteEvent(s, 'zzz')).toBeUndefined()
  })
})

describe('labels and people search', () => {
  it('eventLabel and whenLabel', () => {
    expect(eventLabel(ev())).toBe('Forum Alpbach · 12 Oct 2026, Vienna')
    expect(whenLabel(ev({ to: '2026-10-14' }))).toBe('12 Oct 2026 to 14 Oct 2026')
    expect(whenLabel(ev({ from: '2026-10-12T18:30' }))).toBe('12 Oct 2026 18:30')
  })
  it('matchPeople: prefix, typo, every word must fit; empty query lists the first few', () => {
    const people = [person('1', 'Anna Gruber'), person('2', 'Ben Huber'), person('3', 'Annabelle Moser')]
    expect(matchPeople(people, 'ben').map((p) => p.id)).toEqual(['2'])
    expect(matchPeople(people, 'anna gru').map((p) => p.id)).toEqual(['1'])
    expect(matchPeople(people, 'grubre').map((p) => p.id)).toEqual(['1'])
    expect(matchPeople(people, '', 2).map((p) => p.id)).toEqual(['1', '2'])
  })
})

describe('I1: events never leave the phone', () => {
  it('askSources reads no event name, place or tag', () => {
    const line = { id: 'l1', text: 'Knows a ladder', tag: Tag.Offer, audience: Audience.FriendsOfFriends, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW }
    const s = state({ events: [ev({ name: 'Secret Retreat', where: 'Hallstatt' })] })
    s.people[0].events = ['e1']
    s.people[0].lines = [line]
    const out = JSON.stringify(askSources(s, Ring.Friend, 0).threads)
    expect(out).toContain('ladder')
    for (const leak of ['Secret Retreat', 'Hallstatt', 'e1"']) expect(out).not.toContain(leak)
    expect(s.events).toHaveLength(1)
    expect(s.people[0].events).toEqual(['e1'])
  })
})

describe('hosts and tag name', () => {
  it('hosts are trimmed, empties left out; none means the key is absent', () => {
    expect(ev({ hosts: [' Anna Gruber ', ' ', 'Ben Huber'] })).toMatchObject({ hosts: ['Anna Gruber', 'Ben Huber'] })
    expect(ev({ hosts: [' '] })).not.toHaveProperty('hosts')
    expect(ev()).not.toHaveProperty('hosts')
  })
  it('the tag is called the event name until renamed', () => {
    expect(tagLabel(ev())).toBe('Forum Alpbach')
    expect(tagLabel({ ...ev(), tagName: 'Alpbach 26' })).toBe('Alpbach 26')
  })
  it('localSettings keeps what only this device holds', () => {
    expect(localSettings({ ...ev(), fromLink: true, tagName: 'X', tagLocked: true, hostNamesTags: false })).toEqual({ fromLink: true, tagName: 'X', tagLocked: true, hostNamesTags: false })
    expect(localSettings(ev())).toEqual({})
  })
})
