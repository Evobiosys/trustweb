/**
 * Events (E1, wave 7): where and when I met people, as a per-event tag on a person. Pure and DOM-free.
 * Local only: cascade.ts askSources strips AppState.events and Person.events (I1).
 */
import { termSimilarity, MATCH_THRESHOLD } from './fuzzy'
import type { LinkedEvent } from './event_link'
import type { AppState, Person, TwEvent } from './model'

/** What the form hands over; name, from and where are mandatory. */
export interface EventFields {
  name: string
  from: string
  to?: string
  where: string
  conditions?: string
  themes?: string[]
  organizer?: string
  hosts?: string[]
  /** Default true: I add or join it. */
  attended?: boolean
}

/** The first field that fails, in form order. */
export type EventError = 'name' | 'from' | 'where' | 'to'

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function validDate(v: string): boolean {
  return DATE.test(v) && !Number.isNaN(new Date(v.length === 10 ? `${v}T00:00` : v).getTime())
}

/** "2026-10-12" starts at 00:00; as an end it lasts until 23:59. */
function stamp(v: string, end: boolean): string {
  return v.length === 10 ? `${v}T${end ? '23:59' : '00:00'}` : v
}

export function splitThemes(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))]
}

/** A validated event, or the first field that fails. Optional fields that are empty are left out. */
export function newEvent(f: EventFields, id: string, now: number): TwEvent | EventError {
  const name = f.name.trim()
  const where = f.where.trim()
  const from = f.from.trim()
  const to = f.to?.trim()
  if (!name) return 'name'
  if (!validDate(from)) return 'from'
  if (!where) return 'where'
  if (to && (!validDate(to) || stamp(to, true) < stamp(from, false))) return 'to'
  const conditions = f.conditions?.trim()
  const organizer = f.organizer?.trim()
  const hosts = f.hosts?.map((t) => t.trim()).filter(Boolean)
  const themes = f.themes?.map((t) => t.trim()).filter(Boolean)
  return {
    id, name, from, where, createdAt: now, attended: f.attended ?? true,
    ...(to ? { to } : {}),
    ...(conditions ? { conditions } : {}),
    ...(themes?.length ? { themes } : {}),
    ...(organizer ? { organizer } : {}),
    ...(hosts?.length ? { hosts } : {}),
  }
}

/** What the tag is called on my device. */
export function tagLabel(ev: Pick<TwEvent, 'name' | 'tagName'>): string {
  return ev.tagName ?? ev.name
}

/** The device-local settings an edit of the form must not drop. */
export function localSettings(ev: TwEvent): Pick<TwEvent, 'fromLink' | 'hostNamesTags' | 'tagName' | 'tagLocked'> {
  const { fromLink, hostNamesTags, tagName, tagLocked } = ev
  return { ...(fromLink ? { fromLink } : {}), ...(hostNamesTags !== undefined ? { hostNamesTags } : {}), ...(tagName ? { tagName } : {}), ...(tagLocked ? { tagLocked } : {}) }
}

export function isPast(ev: TwEvent, now: number): boolean {
  return new Date(stamp(ev.to ?? ev.from, true)).getTime() < now
}

/** Upcoming (soonest first), then past (latest first). */
export function eventsSorted(s: AppState, now: number): { upcoming: TwEvent[]; past: TwEvent[] } {
  const all = s.events ?? []
  return {
    upcoming: all.filter((e) => !isPast(e, now)).sort((a, b) => a.from.localeCompare(b.from)),
    past: all.filter((e) => isPast(e, now)).sort((a, b) => b.from.localeCompare(a.from)),
  }
}

/** The people carrying this event's tag. */
export function attendees(s: AppState, eventId: string): Person[] {
  return s.people.filter((p) => p.events?.includes(eventId))
}

export function tagPerson(s: AppState, personId: string, eventId: string): void {
  const p = s.people.find((x) => x.id === personId)
  if (p && !p.events?.includes(eventId)) p.events = [...(p.events ?? []), eventId]
}

export function untagPerson(s: AppState, personId: string, eventId: string): void {
  const p = s.people.find((x) => x.id === personId)
  if (!p?.events) return
  const rest = p.events.filter((e) => e !== eventId)
  if (rest.length) p.events = rest
  else delete p.events
}

/** Adds a linked event as attended and returns its id; an event with that id already held is left as it is (see applyHostLink). */
export function joinEvent(s: AppState, linked: LinkedEvent, now: number): string {
  const { kind: _kind, ...ev } = linked
  if (!s.events?.some((e) => e.id === linked.id)) s.events = [...(s.events ?? []), { ...ev, createdAt: now, attended: true, fromLink: true }]
  return linked.id
}

/** A host link for an event I hold names its tag, unless I keep my own name or do not let the host name it. A peer link never does. */
export function applyHostLink(s: AppState, linked: LinkedEvent): void {
  const mine = s.events?.find((e) => e.id === linked.id)
  if (mine && linked.kind === 'host' && linked.tagName && !mine.tagLocked && mine.hostNamesTags !== false) mine.tagName = linked.tagName
}

/** What deleteEvent took out, to put back (Undo). */
export interface DeletedEvent { event: TwEvent; tagged: string[] }

export function deleteEvent(s: AppState, eventId: string): DeletedEvent | undefined {
  const event = s.events?.find((e) => e.id === eventId)
  if (!event) return undefined
  const tagged = attendees(s, eventId).map((p) => p.id)
  tagged.forEach((id) => untagPerson(s, id, eventId))
  s.events = (s.events ?? []).filter((e) => e.id !== eventId)
  return { event, tagged }
}

export function restoreEvent(s: AppState, d: DeletedEvent): void {
  s.events = [...(s.events ?? []), d.event]
  d.tagged.forEach((id) => tagPerson(s, id, d.event.id))
}

/** "12 Oct 2026" for a date, with the time when it has one. */
export function dateLabel(v: string): string {
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}${v.length > 10 ? ` ${v.slice(11)}` : ''}`
}

/** The date span: "12 Oct 2026" or "12 Oct 2026 to 14 Oct 2026". */
export function whenLabel(ev: Pick<TwEvent, 'from' | 'to'>): string {
  return ev.to && ev.to !== ev.from ? `${dateLabel(ev.from)} to ${dateLabel(ev.to)}` : dateLabel(ev.from)
}

/** "Name · 12 Oct 2026, Vienna" */
export function eventLabel(ev: TwEvent): string {
  return `${ev.name} · ${dateLabel(ev.from)}, ${ev.where}`
}

/** People whose name has a word like one of the query's words (fuzzy.ts), best first; the first few when the query is empty. */
export function matchPeople(people: readonly Person[], query: string, limit = 6): Person[] {
  const words = query.split(/\s+/).filter(Boolean)
  if (!words.length) return people.slice(0, limit)
  const score = (p: Person): number => {
    const parts = p.name.split(/\s+/)
    return Math.min(...words.map((w) => Math.max(...parts.map((n) => (n.toLowerCase().startsWith(w.toLowerCase()) ? 1 : termSimilarity(w, n))))))
  }
  return people.map((p) => ({ p, s: score(p) })).filter((x) => x.s >= MATCH_THRESHOLD).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p)
}
