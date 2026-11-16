// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor: what the calendar-style event editor adds to an event (repeat, conference links, a kDrive attachment, the calendar),
 * drafts of unsaved events, the RSVP tense, direct guest invites, and calendars grouped and switched by tag. Pure, type-only imports,
 * so apps/mcp loads it under plain node. Everything here stays on this device (I1): no field of it goes into an event link.
 */
import type { AppState, TwEvent } from './model.ts'

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly']

/** Conference providers offered next to the place. "custom" = any other https meeting link. */
export const CONFERENCE_PROVIDERS = ['kmeet', 'zoom', 'jitsi', 'custom'] as const
export type ConferenceProvider = typeof CONFERENCE_PROVIDERS[number]
export interface ConferenceLink { provider: ConferenceProvider; url: string }

/** A calendar of mine: a name and the tags it is grouped by (lowercase, no #). */
export interface TwCalendar { id: string; name: string; tags: string[] }
/** AppState.calendars: my own calendars, the tags switched off in the calendar view, and the meeting room per provider I used last. */
export interface CalendarPrefs { list?: TwCalendar[]; off?: string[]; rooms?: Partial<Record<ConferenceProvider, string>> }

/** The editor's fields as typed; a draft keeps them as they are, valid or not. */
export interface EditorFields {
  name: string
  from: string
  to: string
  repeat: Repeat
  /** Invited people (person ids): the existing invite path (TwEvent.people). */
  guests: string[]
  /** Co-hosts (person ids or free names); the creator is one unless technical support only (43-D7). */
  cohosts: string[]
  /** 43-D7: the creator counts as co-host, or is only technical support (sees, approves only when the host lets them take over). */
  meRole: 'cohost' | 'tech'
  where: string
  conference: ConferenceLink[]
  description: string
  attachment: string
  calendar: string
  tagName: string
  coreFrom: string
  coreTo: string
  conditions: string
  themes: string
  organizers: string[]
  techSupport: string[]
  communityId: string
  techTakeover: boolean
}

export interface EventDraft { id: string; savedAt: number; /** The event this draft edits; absent = a new event. */ eventId?: string; fields: EditorFields }

const DEFAULT_CALENDAR = 'mine'
/** Mine (events I made) and Shared with me (events that came in through a link). */
export const BUILTIN_CALENDARS: readonly TwCalendar[] = [
  { id: 'mine', name: 'My events', tags: ['mine'] },
  { id: 'shared', name: 'Shared with me', tags: ['shared'] },
]

const https = (v: string, what: string): string => {
  let u: URL
  try { u = new URL(v.trim()) } catch { throw new Error(`${what} must be an https link`) }
  if (u.protocol !== 'https:') throw new Error(`${what} must be an https link`)
  return u.href
}

export interface EventDetailsPatch { repeat?: string; conference?: { provider: string; url: string }[]; attachment?: string; description?: string; calendar?: string }

/** Sets the details given; a default (no repeat, no link, empty text, my default calendar) is not stored. Throws on a bad value and then changes nothing. */
export function applyEventDetails(ev: TwEvent, p: EventDetailsPatch): void {
  if (p.repeat !== undefined && !REPEATS.includes(p.repeat as Repeat)) throw new Error(`repeat must be one of ${REPEATS.join(', ')}`)
  const conference = p.conference?.map((c): ConferenceLink => {
    if (!(CONFERENCE_PROVIDERS as readonly string[]).includes(c.provider)) throw new Error(`conference provider must be one of ${CONFERENCE_PROVIDERS.join(', ')}`)
    return { provider: c.provider as ConferenceProvider, url: https(c.url, 'a conference link') }
  })
  const attachment = p.attachment?.trim() ? https(p.attachment, 'the attachment') : p.attachment
  if (p.repeat !== undefined) { if (p.repeat === 'none') delete ev.repeat; else ev.repeat = p.repeat as Repeat }
  if (conference) { if (conference.length) ev.conference = conference; else delete ev.conference }
  if (attachment !== undefined) { if (attachment) ev.attachment = attachment; else delete ev.attachment }
  if (p.description !== undefined) {
    const d = p.description.trim()
    const docs: NonNullable<TwEvent['docs']> = { ...ev.docs, description: d }
    if (!d) delete docs.description
    if (Object.keys(docs).length) ev.docs = docs; else delete ev.docs
  }
  if (p.calendar !== undefined) { const c = p.calendar.trim(); if (c && c !== DEFAULT_CALENDAR) ev.calendar = c; else delete ev.calendar }
}

/** Providers I have a room link for ("connected"); the others show greyed until I paste one. */
export const connectedProviders = (s: Pick<AppState, 'calendars'>): ConferenceProvider[] =>
  CONFERENCE_PROVIDERS.filter((p) => s.calendars?.rooms?.[p])

export function rememberRooms(s: Pick<AppState, 'calendars'>, links: readonly ConferenceLink[]): void {
  if (!links.length) return
  const rooms = { ...s.calendars?.rooms }
  for (const l of links) rooms[l.provider] = l.url
  s.calendars = { ...s.calendars, rooms }
}

export function emptyFields(today: string, meName: string): EditorFields {
  return {
    name: '', from: today, to: '', repeat: 'none', guests: [], cohosts: meName.trim() ? [meName.trim()] : [], meRole: 'cohost',
    where: '', conference: [], description: '', attachment: '', calendar: DEFAULT_CALENDAR,
    tagName: '', coreFrom: '', coreTo: '', conditions: '', themes: '', organizers: [], techSupport: [], communityId: '', techTakeover: false,
  }
}

export const isDirty = (start: EditorFields, now: EditorFields): boolean => JSON.stringify(start) !== JSON.stringify(now)

export const draftsOf = (s: Pick<AppState, 'eventDrafts'>): EventDraft[] => s.eventDrafts ?? []

/** Keeps the fields as a draft (the same id replaces the old one); returns the id. */
export function saveDraft(s: Pick<AppState, 'eventDrafts'>, fields: EditorFields, now: number, id: string, eventId?: string): string {
  const d: EventDraft = { id, savedAt: now, fields: structuredClone(fields), ...(eventId ? { eventId } : {}) }
  s.eventDrafts = [...draftsOf(s).filter((x) => x.id !== id), d]
  return id
}

export function dropDraft(s: Pick<AppState, 'eventDrafts'>, id: string): void {
  const rest = draftsOf(s).filter((d) => d.id !== id)
  if (rest.length) s.eventDrafts = rest; else delete s.eventDrafts
}

/** Item 13: "I will attend" while the event has not started, past tense from its start on. */
export function rsvpTense(ev: Pick<TwEvent, 'from'>, now: number): 'future' | 'past' {
  const start = new Date(ev.from.length === 10 ? `${ev.from}T00:00` : ev.from).getTime()
  return start > now ? 'future' : 'past'
}

/** Invites people directly (TwEvent.people, the calendar's invite path); `cohost` also makes them hosts. Nobody twice. */
export function inviteGuests(ev: TwEvent, ids: readonly string[], cohost = false): void {
  const add = (list: readonly string[] | undefined): string[] => [...new Set([...(list ?? []), ...ids.map((i) => i.trim()).filter(Boolean)])]
  if (!ids.length) return
  ev.people = add(ev.people)
  if (cohost) ev.hosts = add(ev.hosts)
}

export const calendarsOf = (s: Pick<AppState, 'calendars'>): TwCalendar[] => [...BUILTIN_CALENDARS, ...(s.calendars?.list ?? [])]

export const calendarOf = (ev: Pick<TwEvent, 'calendar' | 'fromLink'>): string => ev.calendar ?? (ev.fromLink ? 'shared' : DEFAULT_CALENDAR)

/** Every tag of my calendars, first seen first. */
export const calendarTags = (s: Pick<AppState, 'calendars'>): string[] => [...new Set(calendarsOf(s).flatMap((c) => c.tags))]

const tagWords = (text: string): string[] => [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean))]

/** A calendar of mine with "#here #anna" (or comma separated) tags; returns its id. */
export function addCalendar(s: Pick<AppState, 'calendars'>, name: string, tags: string, id: string): string {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('a calendar needs a name')
  s.calendars = { ...s.calendars, list: [...(s.calendars?.list ?? []), { id, name: n, tags: tagWords(tags) }] }
  return id
}

/** Switches a tag off (hides every calendar carrying it) or on; `on` absent = flip. */
export function toggleCalendarTag(s: Pick<AppState, 'calendars'>, tag: string, on?: boolean): boolean {
  const t = tagWords(tag)[0] ?? ''
  const off = new Set(s.calendars?.off ?? [])
  const nowOn = on ?? off.has(t)
  if (nowOn) off.delete(t); else off.add(t)
  const next: CalendarPrefs = { ...s.calendars, off: [...off] }
  if (!off.size) delete next.off
  s.calendars = next
  return nowOn
}

/** Shown unless its calendar carries a tag that is switched off. */
export function calendarVisible(s: Pick<AppState, 'calendars'>, ev: Pick<TwEvent, 'calendar' | 'fromLink'>): boolean {
  const off = s.calendars?.off ?? []
  if (!off.length) return true
  const cal = calendarsOf(s).find((c) => c.id === calendarOf(ev))
  return !cal?.tags.some((t) => off.includes(t))
}
