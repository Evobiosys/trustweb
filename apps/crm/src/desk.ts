/** What the Desk view derives from the Curator's own data: pure and DOM-free, nothing stored twice. Every list takes the people the Desk already filtered (people.svelte's rules). */
import type { Person, TwEvent } from '../../trustweb/src/model'
import { LineStatus } from '../../trustweb/src/model'
import { stops } from './close'
import type { Close } from './close'
import { norm } from './contacts'
import { dayKey, daysUntil, endOfDay } from './dates'
import { baseFields, fieldById, fieldLabelOf, valueText, ADHOC } from './fields'
import type { FieldValues } from './fields'
import { lastPastByPerson } from './display'
import type { CrmState, CrmView, FollowUp, KeepInTouch } from './model'
import { View } from './nav'
import { FAMILY_KEY, UNSORTED, ringOf } from './rings'
import { S } from './strings'
import { EventKind, dueFollowUps, timeline } from './timeline'

const DAY = 86_400_000
const BIRTHDAY_DAYS = 14
const RESURFACE_SHOWN = 3
const EVENTS_SHOWN = 5

/** What every Desk component reads, computed once per render in desk.svelte over the visible people. */
export interface DeskData {
  now: number
  view: CrmView
  values: (id: string) => FieldValues
  past: Map<string, number>
  reminders: FollowUp[]
  kit: KeepRow[]
}

export const CADENCES: readonly number[] = [7, 14, 30, 90, 180, 365]

export const viewOf = (x: unknown): View => (x === View.Desk ? View.Desk : View.Classic)

export function greeting(hour: number, name: string): string {
  const g = S.desk.greeting
  const word = hour >= 5 && hour < 12 ? g.morning : hour >= 12 && hour < 18 ? g.afternoon : g.evening
  return name ? `${word}, ${name}` : word
}

/** Per person, when something last happened up to `now`; a due reminder is no contact and a planned meeting has not happened. One timeline per render. */
export const activityOf = (view: CrmView, now: number): Map<string, number> =>
  lastPastByPerson(timeline(view).filter((e) => e.kind !== EventKind.FollowUp && e.kind !== EventKind.Planned), now)

const labelOf = (key: string): string => fieldById(key)?.label ?? (key.startsWith(ADHOC) ? fieldLabelOf(key) : '')

const dayNumber = (now: number): number => { const d = new Date(now); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) }

export interface Resurfaced {
  person: Person
  context: string
}

/** Up to three people worth a nudge, rotating by day: placed or family, quiet longer than `days`, no cadence, no open follow-up; most notes and interactions first. */
export function resurface(view: CrmView, past: Map<string, number>, now: number, days: number): Resurfaced[] {
  const { crm } = view
  const open = new Set(crm.followUps.filter((f) => !f.doneAt).map((f) => f.personId))
  const talks = new Map<string, number>()
  for (const i of crm.interactions) talks.set(i.personId, (talks.get(i.personId) ?? 0) + 1)
  const weight = (p: Person): number => p.lines.length + (talks.get(p.id) ?? 0)
  const ranked = view.app.people
    .filter((p) => (ringOf(p.ring) !== UNSORTED || baseFields(p)?.[FAMILY_KEY] === true) && !crm.keepInTouch?.[p.id] && !open.has(p.id) && (past.get(p.id) ?? 0) < now - days * DAY)
    .sort((a, b) => weight(b) - weight(a) || (past.get(a.id) ?? 0) - (past.get(b.id) ?? 0) || a.id.localeCompare(b.id))
  const shown = Math.min(RESURFACE_SHOWN, ranked.length)
  return Array.from({ length: shown }, (_, i) => ranked[(dayNumber(now) + i) % ranked.length]).map((person) => {
    const newest = person.lines.filter((l) => l.status === LineStatus.Current).sort((a, b) => b.notedAt - a.notedAt)[0]
    return { person, context: (newest && (crm.lineEdits?.[newest.id]?.text ?? newest.text)) || person.context }
  })
}

export interface Birthday {
  name: string
  role: string
  /** Local midnight of the next occurrence. */
  at: number
  personId?: string
  contactId?: string
}

const monthDay = (text: string): [number, number] | null => {
  const m = /^(?:\d{4}|-)-(\d{2})-(\d{2})/.exec(text.trim())
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? [Number(m[1]), Number(m[2])] : null
}

/** The next time month/day falls on or after today; a Feb 29 birthday is kept on Feb 28 in years without one. */
function nextOccurrence(month: number, day: number, now: number): number {
  const at = (year: number): number => {
    const leap = new Date(year, 1, 29).getMonth() === 1
    return new Date(year, month - 1, month === 2 && day === 29 && !leap ? 28 : day).getTime()
  }
  const year = new Date(now).getFullYear()
  return daysUntil(at(year), now) < 0 ? at(year + 1) : at(year)
}

const ROLE_KEYS = ['kmdhbPwaDOem', '_YL-QcVZ2i0H']

/** Birthdays in the next 14 days, soonest first: imported contacts' birthday and person fields labelled "birth" that hold a month and day. */
export function birthdays(view: CrmView, values: (id: string) => FieldValues, now: number): Birthday[] {
  const out: Birthday[] = []
  const add = (md: [number, number] | null, rest: Omit<Birthday, 'at'>): void => {
    if (!md) return
    const at = nextOccurrence(md[0], md[1], now)
    if (daysUntil(at, now) <= BIRTHDAY_DAYS) out.push({ ...rest, at })
  }
  for (const c of view.crm.contacts ?? []) add(c.birthday ? monthDay(c.birthday) : null, { name: c.name, role: c.title ?? c.org ?? '', contactId: c.id })
  for (const p of view.app.people) {
    const v = values(p.id)
    const key = Object.keys(v).find((k) => /birth/i.test(labelOf(k)) && monthDay(valueText(v[k])))
    const role = ROLE_KEYS.map((k) => valueText(v[k])).find(Boolean) ?? p.context
    add(key ? monthDay(valueText(v[key])) : null, { name: p.name, role, personId: p.id })
  }
  return out.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
}

export interface KeepRow {
  person: Person
  everyDays: number
  /** Local midnight of the due day. */
  dueAt: number
  /** Due today or overdue, and not snoozed. */
  due: boolean
}

/** Everyone with a cadence, soonest due first: due = the newer of last activity and `since`, plus the cadence in whole local days. */
export function keepInTouchDue(view: CrmView, past: Map<string, number>, now: number): KeepRow[] {
  const rows: KeepRow[] = []
  for (const person of view.app.people) {
    const k: KeepInTouch | undefined = view.crm.keepInTouch?.[person.id]
    if (!k) continue
    const d = new Date(Math.max(past.get(person.id) ?? 0, k.since))
    const dueAt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k.everyDays).getTime()
    rows.push({ person, everyDays: k.everyDays, dueAt, due: daysUntil(dueAt, now) <= 0 && !(k.snoozedUntil && k.snoozedUntil > now) })
  }
  return rows.sort((a, b) => a.dueAt - b.dueAt || a.person.name.localeCompare(b.person.name))
}

export const cadenceLabel = (days: number): string => S.desk.cadence[days] ?? S.desk.cadenceDays(days)

/** "18 Apr": day first, the Europe default. */
export const shortDate = (at: number): string => `${new Date(at).getDate()} ${S.monthShort[new Date(at).getMonth()]}`

export interface Step {
  key: 'name' | 'ring' | 'contacts' | 'notes' | 'installed'
  done: boolean
}

const MANY_PEOPLE = 5

/** The five Getting-started steps, derived on every read and never stored. */
export function gettingStarted(view: CrmView, pkms: readonly unknown[], installed: boolean): Step[] {
  return [
    { key: 'name', done: view.app.me.displayName.trim() !== '' },
    { key: 'ring', done: view.app.people.some((p) => ringOf(p.ring) !== UNSORTED) },
    { key: 'contacts', done: (view.crm.contacts ?? []).length > 0 || view.app.people.length > MANY_PEOPLE },
    { key: 'notes', done: pkms.length > 0 },
    { key: 'installed', done: installed },
  ]
}

export interface PlaceGroup {
  place: string
  people: Person[]
}

const PLACE_LABEL = /resid|city|location|address|lives|wohn/i

/** People grouped by place, biggest first: the newest interaction's place, else a place-like field, else one of my close places named in any field. No map, no lookup. */
export function placesOf(view: CrmView, values: (id: string) => FieldValues, close: Close): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>()
  const met = new Map<string, { at: number; place: string }>()
  for (const i of view.crm.interactions) if (i.place && i.at > (met.get(i.personId)?.at ?? -Infinity)) met.set(i.personId, { at: i.at, place: i.place })
  for (const person of view.app.people) {
    const v = values(person.id)
    const newest = met.get(person.id)?.place
    const field = Object.keys(v).filter((k) => PLACE_LABEL.test(labelOf(k))).map((k) => valueText(v[k])).find(Boolean)
    const texts = Object.values(v).map((x) => valueText(x).toLowerCase())
    const stop = close.places.flatMap(stops).find((s) => texts.some((t) => t.includes(s)))
    const place = newest ?? field ?? (stop && stop[0].toUpperCase() + stop.slice(1))
    if (!place) continue
    const key = norm(place.trim())
    const g = groups.get(key) ?? { place: place.trim(), people: [] }
    g.people.push(person)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.people.length - a.people.length || a.place.localeCompare(b.place))
}

export interface EventRow {
  id: string
  name: string
  when: string
}

/** Events that end today or later, soonest first, at most five: "09:00–09:45", "Fri 18:30" on another day, "All day" without a time. */
export function deskEvents(events: readonly TwEvent[] | undefined, now: number): EventRow[] {
  const today = dayKey(now)
  return [...(events ?? [])]
    .filter((e) => (e.to ?? e.from).slice(0, 10) >= today)
    .sort((a, b) => a.from.localeCompare(b.from))
    .slice(0, EVENTS_SHOWN)
    .map((e) => {
      const day = e.from.slice(0, 10)
      if (e.from.length <= 10) return { id: e.id, name: e.name, when: S.desk.allDay }
      const [y, m, d] = day.split('-').map(Number)
      const lead = day > today ? `${S.desk.weekdayShort[new Date(y, m - 1, d).getDay()]} ` : ''
      const end = e.to && e.to.length > 10 && e.to.slice(0, 10) === day ? `–${e.to.slice(11, 16)}` : ''
      return { id: e.id, name: e.name, when: `${lead}${e.from.slice(11, 16)}${end}` }
    })
}

/** Open follow-ups due today or overdue, oldest first. */
export const remindersDue = (crm: CrmState, now: number) => dueFollowUps(crm, endOfDay(now))

export interface CommandOption {
  kind: 'remind' | 'note' | 'open' | 'search'
  personId?: string
  text: string
}

/** What the command box offers for the text: the person it names (a 3+ letter word that starts a name part; most parts wins) gets remind / note and open; always a people search. No AI, no network. */
export function commandOptions(text: string, people: readonly Person[]): CommandOption[] {
  const t = text.trim()
  if (!t) return []
  const words = norm(t).split(/\s+/).filter((w) => w.length >= 3)
  const score = (p: Person): number => norm(p.name).split(/\s+/).filter((part) => words.some((w) => part.startsWith(w))).length
  const best = people.reduce<{ p?: Person; n: number }>((b, p) => (score(p) > b.n ? { p, n: score(p) } : b), { n: 0 }).p
  const search: CommandOption = { kind: 'search', text: t }
  if (!best) return [search]
  return [{ kind: /remind|follow up/i.test(t) ? 'remind' : 'note', personId: best.id, text: t }, { kind: 'open', personId: best.id, text: t }, search]
}

/** The person a merged-away id now lives on. */
function survivor(merges: readonly { from: string; into: string }[], id: string): string {
  let cur = id
  for (let i = 0; i < merges.length; i++) {
    const m = merges.find((x) => x.from === cur)
    if (!m) break
    cur = m.into
  }
  return cur
}

/** Favorites as people now are: merged ids follow crm.merges, duplicates collapse; the stored list is never pruned. */
export const favoriteIds = (favs: readonly string[], merges: readonly { from: string; into: string }[] = []): string[] =>
  [...new Set(favs.map((id) => survivor(merges, id)))]

/** The stored list after the star on `id` was pressed. */
export function toggleFavorite(favs: readonly string[], merges: readonly { from: string; into: string }[], id: string): string[] {
  const s = survivor(merges, id)
  return favoriteIds(favs, merges).includes(s) ? favs.filter((f) => survivor(merges, f) !== s) : [...favs, s]
}
