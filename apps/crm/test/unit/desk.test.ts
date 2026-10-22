import { describe, expect, it } from 'vitest'
import { Audience, LineStatus, Ring, Tag } from '../../../trustweb/src/model'
import type { NoteLine, Person } from '../../../trustweb/src/model'
import { emptyClose } from '../../src/close'
import {
  activityOf, birthdays, cadenceLabel, commandOptions, deskEvents, favoriteIds, gettingStarted, greeting, keepInTouchDue, placesOf, remindersDue, resurface, toggleFavorite, viewOf,
} from '../../src/desk'
import type { FieldValues } from '../../src/fields'
import { InteractionKind, emptyCrm } from '../../src/model'
import type { CrmView } from '../../src/model'
import { View } from '../../src/nav'
import { sampleApp } from '../../src/sample'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 22, 10).getTime()

const line = (id: string, text: string, notedAt: number): NoteLine => ({ id, text, tag: Tag.Note, audience: Audience.Friends, status: LineStatus.Current, notedAt, checkedAt: notedAt })
const person = (id: string, over: Partial<Person> = {}): Person => ({ id, name: id.toUpperCase(), context: `ctx ${id}`, ring: Ring.Friend, metAt: NOW - 100 * DAY, lines: [], ...over })
function viewOfPeople(people: Person[], crm = emptyCrm()): CrmView {
  return { app: { ...sampleApp(NOW), people, peers: [], log: [] }, crm }
}
const ids = (xs: { person: Person }[]): string[] => xs.map((x) => x.person.id)

describe('viewOf', () => {
  it('accepts desk, else classic', () => {
    expect(viewOf('desk')).toBe(View.Desk)
    expect(viewOf('classic')).toBe(View.Classic)
    expect(viewOf(undefined)).toBe(View.Classic)
    expect(viewOf('x')).toBe(View.Classic)
  })
})

describe('greeting', () => {
  it('follows the hour and names the person', () => {
    expect(greeting(5, 'Anna')).toBe('Good morning, Anna')
    expect(greeting(11, 'Anna')).toBe('Good morning, Anna')
    expect(greeting(12, 'Anna')).toBe('Good afternoon, Anna')
    expect(greeting(17, 'Anna')).toBe('Good afternoon, Anna')
    expect(greeting(18, 'Anna')).toBe('Good evening, Anna')
    expect(greeting(3, 'Anna')).toBe('Good evening, Anna')
  })
  it('drops the comma without a name', () => {
    expect(greeting(8, '')).toBe('Good morning')
  })
})

describe('resurface', () => {
  const crm = () => ({ ...emptyCrm(), followUps: [{ id: 'f', personId: 'open', text: 't', dueAt: NOW + DAY, createdAt: NOW }] })
  it('skips cadence people, open follow-ups, unsorted, recent ones; ranks by notes then age', () => {
    const c = crm()
    c.keepInTouch = { cad: { everyDays: 7, since: NOW } }
    const people = [
      person('few', { lines: [line('a', 'one', NOW - 50 * DAY)] }),
      person('many', { lines: [line('b', 'x', NOW - 60 * DAY), line('c', 'newest', NOW - 55 * DAY)] }),
      person('cad', { lines: [line('d', 'x', NOW - 60 * DAY)] }),
      person('open'),
      person('uns', { ring: Ring.None }),
      person('recent', { metAt: NOW - DAY }),
    ]
    const view = viewOfPeople(people, c)
    const out = resurface(view, activityOf(view, NOW), NOW, 7)
    expect(ids(out).sort()).toEqual(['few', 'many'])
    expect(out.find((r) => r.person.id === 'many')!.context).toBe('newest')
    expect(out.find((r) => r.person.id === 'few')!.context).toBe('one')
  })
  it('stays linear at 700 people, 7000 interactions, well under 50 ms (counts once, not per comparison)', () => {
    const people = Array.from({ length: 700 }, (_, i) => person(`p${i}`, { lines: [line(`l${i}`, 'x', NOW - (30 + (i % 50)) * DAY)] }))
    const c = { ...emptyCrm(), interactions: Array.from({ length: 7000 }, (_, i) => ({ id: `i${i}`, personId: `p${i % 700}`, at: NOW - 40 * DAY, kind: InteractionKind.Note, text: '' })) }
    const view = viewOfPeople(people, c)
    const past = activityOf(view, NOW)
    const t0 = performance.now()
    resurface(view, past, NOW, 7)
    placesOf(view, () => ({}), emptyClose())
    expect(performance.now() - t0).toBeLessThan(50)
  })
  it('a due reminder is no contact', () => {
    const c = emptyCrm()
    c.followUps = [{ id: 'f', personId: 'p', text: 't', dueAt: NOW - DAY, createdAt: NOW - 90 * DAY, doneAt: NOW - DAY }]
    const view = viewOfPeople([person('p')], c)
    expect(resurface(view, activityOf(view, NOW), NOW, 7).length).toBe(1)
  })
  it('rotates daily and deterministically over more than three', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id))
    const view = viewOfPeople(people)
    const past = activityOf(view, NOW)
    const day1 = ids(resurface(view, past, NOW, 7))
    const day2 = ids(resurface(view, past, NOW + DAY, 7))
    expect(day1.length).toBe(3)
    expect(day2).not.toEqual(day1)
    expect(ids(resurface(view, past, NOW, 7))).toEqual(day1)
  })
})

describe('birthdays', () => {
  const none = (): FieldValues => ({})
  const view = (contacts: { id: string; name: string; birthday: string; title?: string }[]): CrmView =>
    viewOfPeople([], { ...emptyCrm(), contacts: contacts.map((c) => ({ phones: [], emails: [], labels: [], sources: [], ...c })) })
  it('lists the next 14 days soonest first and wraps the year end', () => {
    const now = new Date(2026, 11, 28, 9).getTime()
    const rows = birthdays(view([
      { id: 'c1', name: 'Jan', birthday: '1985-01-05' },
      { id: 'c2', name: 'Dec', birthday: '--12-30', title: 'Chef' },
      { id: 'c3', name: 'Far', birthday: '--02-01' },
    ]), none, now)
    expect(rows.map((r) => r.name)).toEqual(['Dec', 'Jan'])
    expect(rows[0].role).toBe('Chef')
    expect(rows[0].contactId).toBe('c2')
  })
  it('moves Feb 29 to Feb 28 in a non-leap year, keeps it in a leap year', () => {
    const leap = view([{ id: 'c', name: 'Leap', birthday: '2000-02-29' }])
    const at = (now: number): Date => new Date(birthdays(leap, none, now)[0].at)
    expect([at(new Date(2027, 1, 20).getTime()).getMonth(), at(new Date(2027, 1, 20).getTime()).getDate()]).toEqual([1, 28])
    expect(at(new Date(2028, 1, 20).getTime()).getDate()).toBe(29)
  })
  it('reads a person field with "birth" in its label, never a bare year', () => {
    const p = person('p', { context: 'role' })
    const v = viewOfPeople([p])
    const values = (): FieldValues => ({ 'adhoc:Birthday': '1990-10-25', 'adhoc:Year of Birth': '1990' })
    const rows = birthdays(v, values, NOW)
    expect(rows.map((r) => r.name)).toEqual(['P'])
    expect(rows[0].personId).toBe('p')
    expect(birthdays(v, () => ({ 'adhoc:Year of Birth': '1990' }), NOW)).toEqual([])
  })
})

describe('keepInTouchDue', () => {
  it('uses the newer of interaction and note, whole days', () => {
    const c = emptyCrm()
    c.keepInTouch = { p: { everyDays: 7, since: NOW - 100 * DAY } }
    c.interactions = [{ id: 'i', personId: 'p', at: NOW - 20 * DAY, kind: InteractionKind.Call, text: '' }]
    const p = person('p', { metAt: NOW - 200 * DAY, lines: [line('n', 'x', NOW - 3 * DAY)] })
    const view = viewOfPeople([p], c)
    const [row] = keepInTouchDue(view, activityOf(view, NOW), NOW)
    expect(row.due).toBe(false)
    expect(new Date(row.dueAt).getDate()).toBe(new Date(NOW + 4 * DAY).getDate())
    c.interactions[0].at = NOW - 9 * DAY
    c.keepInTouch.p.since = NOW - 100 * DAY
    c.keepInTouch.p.everyDays = 7
    p.lines = []
    expect(keepInTouchDue(view, activityOf(view, NOW), NOW)[0].due).toBe(true)
  })
  it('anchors at since without activity, honours snooze', () => {
    const c = emptyCrm()
    const p = person('p', { metAt: NOW + 400 * DAY })
    c.keepInTouch = { p: { everyDays: 7, since: NOW - 8 * DAY } }
    const view = viewOfPeople([p], c)
    expect(keepInTouchDue(view, activityOf(view, NOW), NOW)[0].due).toBe(true)
    c.keepInTouch.p.snoozedUntil = NOW + DAY
    expect(keepInTouchDue(view, activityOf(view, NOW), NOW)[0].due).toBe(false)
  })
})

describe('cadenceLabel', () => {
  it('names the six steps', () => {
    expect([7, 14, 30, 90, 180, 365].map(cadenceLabel)).toEqual(['Every week', 'Every 2 weeks', 'Every month', 'Every 3 months', 'Every 6 months', 'Every year'])
    expect(cadenceLabel(10)).toBe('Every 10 days')
  })
})

describe('gettingStarted', () => {
  it('counts the five derived steps', () => {
    const v = viewOfPeople([person('a', { ring: Ring.None })])
    v.app.me.displayName = ''
    expect(gettingStarted(v, [], false).filter((s) => s.done).length).toBe(0)
    v.app.me.displayName = 'A'
    v.app.people[0].ring = Ring.Close
    expect(gettingStarted(v, ['tana'], true).filter((s) => s.done).length).toBe(4)
    v.crm.contacts = [{ id: 'c', name: 'n', phones: [], emails: [], labels: [], sources: [] }]
    expect(gettingStarted(v, ['tana'], true).every((s) => s.done)).toBe(true)
  })
})

describe('placesOf', () => {
  it('prefers interaction place over field over close place, groups by normalised name', () => {
    const c = emptyCrm()
    c.interactions = [
      { id: '1', personId: 'a', at: NOW - 2 * DAY, kind: InteractionKind.Met, text: '', place: 'Café X' },
      { id: '2', personId: 'a', at: NOW - 9 * DAY, kind: InteractionKind.Met, text: '', place: 'Old' },
    ]
    const people = [person('a'), person('b'), person('c'), person('d')]
    const close = { ...emptyClose(), places: ['Vienna', 'Graz'] }
    const values = (id: string): FieldValues => id === 'b' ? { 'adhoc:City': 'Vienna' } : id === 'c' ? { xu0y_4Pu3sOL: 'vienna' } : id === 'd' ? { 'adhoc:Notes': 'moved to Graz' } : {}
    const out = placesOf(viewOfPeople(people, c), values, close)
    expect(out.map((g) => [g.place, g.people.map((p) => p.id)])).toEqual([['Vienna', ['b', 'c']], ['Café X', ['a']], ['Graz', ['d']]])
  })
})

describe('deskEvents', () => {
  const ev = (id: string, from: string, to?: string) => ({ id, name: id, from, ...(to ? { to } : {}), where: '', createdAt: 0, attended: true })
  it('keeps today and later, soonest first, max 5, formats times', () => {
    const list = [ev('old', '2026-10-01'), ev('t', '2026-10-22T09:00', '2026-10-22T09:45'), ev('span', '2026-10-20', '2026-10-23'),
      ev('fri', '2026-10-23T18:30'), ...['a', 'b', 'c', 'd'].map((n) => ev(n, '2026-11-01'))]
    const rows = deskEvents(list, NOW)
    expect(rows.map((r) => r.id)).toEqual(['span', 't', 'fri', 'a', 'b'])
    expect(rows.find((r) => r.id === 't')!.when).toBe('09:00–09:45')
    expect(rows.find((r) => r.id === 'span')!.when).toBe('All day')
    expect(rows.find((r) => r.id === 'fri')!.when).toBe('Fri 18:30')
    expect(deskEvents(undefined, NOW)).toEqual([])
  })
})

describe('remindersDue', () => {
  it('includes today and overdue open follow-ups only', () => {
    const c = emptyCrm()
    const mk = (id: string, dueAt: number, doneAt?: number) => ({ id, personId: 'p', text: id, dueAt, createdAt: 0, ...(doneAt ? { doneAt } : {}) })
    c.followUps = [mk('over', NOW - 2 * DAY), mk('today', new Date(2026, 9, 22, 23, 59).getTime()), mk('later', NOW + 3 * DAY), mk('done', NOW - DAY, NOW)]
    expect(remindersDue(c, NOW).map((f) => f.id)).toEqual(['over', 'today'])
  })
})

describe('commandOptions', () => {
  const people = [person('a', { name: 'Anna Berger' }), person('b', { name: 'Anton Berger Meier' }), person('c', { name: 'Zoe Roth' })]
  it('with no person: only a people search', () => {
    expect(commandOptions('buy milk', people)).toEqual([{ kind: 'search', text: 'buy milk' }])
  })
  it('names the best person: remind on "remind" / "follow up", else note, plus open and search', () => {
    const r = commandOptions('remind Anton Berger about the budget', people)
    expect(r[0]).toEqual({ kind: 'remind', personId: 'b', text: 'remind Anton Berger about the budget' })
    expect(r.map((o) => o.kind)).toEqual(['remind', 'open', 'search'])
    expect(commandOptions('Follow up with Zoe', people)[0].kind).toBe('remind')
    expect(commandOptions('Zoe sent pricing', people)[0]).toEqual({ kind: 'note', personId: 'c', text: 'Zoe sent pricing' })
  })
  it('needs a 3-letter prefix of a name token and ignores empty text', () => {
    expect(commandOptions('zo', people).map((o) => o.kind)).toEqual(['search'])
    expect(commandOptions('  ', people)).toEqual([])
  })
})

describe('favorites', () => {
  const merges = [{ from: 'a', into: 'b' }, { from: 'b', into: 'c' }]
  it('follow merges to the survivor without pruning', () => {
    expect(favoriteIds(['a', 'x', 'c'], merges)).toEqual(['c', 'x'])
  })
  it('toggle adds the survivor or removes every id that resolves to it', () => {
    expect(toggleFavorite(['x'], merges, 'a')).toEqual(['x', 'c'])
    expect(toggleFavorite(['a', 'x', 'c'], merges, 'c')).toEqual(['x'])
  })
})
