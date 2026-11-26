/**
 * Events (E1, wave 7): where and when I met people, as a per-event tag on a person. Pure and DOM-free.
 * Local only: cascade.ts askSources strips AppState.events and Person.events (I1).
 */
import { termSimilarity, MATCH_THRESHOLD } from './fuzzy'
import type { EventBy, LinkedEvent } from './event_link'
import { Ring, RINGS, ringSlot } from './model'
import { sendHit } from './org_hits'
import { eventOrganizers, isEventHost, joinEventCommunity, mayApprove, roleNames, sameName } from './event_roles'
import { eventNotifies } from './event_notify'
import { restoreTrashed, trashItems } from './trash' // wave44c answers-44c (A4)
import { DEFAULT_INVITE_POLICY, NICK_FALLBACK, nameRevealOf, stamp, timesError } from './event_press'
export { DEFAULT_INVITE_POLICY, DEFAULT_NAME_REVEAL, NICK_FALLBACK, EVENT_OFFERS_DEFAULT, INVITE_POLICIES, NAME_REVEALS, applyEventSettings, eventOffersFeed, migrateNicknames, nameRevealOf, nickFor, nicknamesOf, offersOf, setEventTimes, setNicknames } from './event_press'
export type { EventOffers, EventSettingsPatch, InvitePolicy, NameReveal } from './event_press'
import type { AppState, Person, TwEvent } from './model'

/** What the form hands over; name and from are mandatory, where may be empty. */
export interface EventFields {
  name: string
  from: string
  to?: string
  where: string
  conditions?: string
  themes?: string[]
  organizer?: string
  organizers?: string[]
  hosts?: string[]
  techSupport?: string[]
  /** The days everyone is there; both ends or none (empty ends = none). */
  core?: { from: string; to: string }
  /** Default true: I add or join it. */
  attended?: boolean
}

/** The first field that fails, in form order. */
export type EventError = 'name' | 'from' | 'to' | 'core'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
  const cf = f.core?.from.trim() ?? ''
  const ct = f.core?.to.trim() ?? ''
  const core = cf || ct ? { from: cf, to: ct } : undefined
  const bad = timesError(from, to, core)
  if (bad) return bad
  const conditions = f.conditions?.trim()
  const organizers = (f.organizers ?? (f.organizer ? [f.organizer] : [])).map((t) => t.trim()).filter(Boolean)
  const organizer = f.organizer?.trim() || organizers.join(', ')
  const hosts = f.hosts?.map((t) => t.trim()).filter(Boolean)
  const techSupport = f.techSupport?.map((t) => t.trim()).filter(Boolean)
  const themes = f.themes?.map((t) => t.trim()).filter(Boolean)
  return {
    id, name, from, where, createdAt: now, attended: f.attended ?? true,
    ...(to ? { to } : {}),
    ...(core ? { core } : {}),
    ...(conditions ? { conditions } : {}),
    ...(themes?.length ? { themes } : {}),
    ...(organizers.length ? { organizers } : {}),
    ...(organizer ? { organizer } : {}),
    ...(hosts?.length ? { hosts } : {}),
    ...(techSupport?.length ? { techSupport } : {}),
  }
}

export { eventTagLabel, eventTagSlug } from './event_tag'

/** What the tag is called on my device. */
export function tagLabel(ev: Pick<TwEvent, 'name' | 'tagName'>): string {
  return ev.tagName ?? ev.name
}

/** Every word of the query starts a word of the event's name, tag name or place (case-insensitive); an empty query matches all. */
export function eventMatches(ev: Pick<TwEvent, 'name' | 'tagName' | 'where'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${ev.name} ${ev.tagName ?? ''} ${ev.where}`.toLowerCase().split(/\s+/)
  return words.every((w) => hay.some((h) => h.startsWith(w)))
}

/** The device-local settings an edit of the form must not drop. */
export function localSettings(ev: TwEvent): Pick<TwEvent, 'fromLink' | 'hostNamesTags' | 'tagName' | 'tagLocked' | 'nameReveal' | 'notify' | 'invitePolicy' | 'offers' | 'communityId' | 'myNickname' | 'mastodonInstance' | 'linkMode' | 'showMe' | 'shareCommunity' | 'announcedAt' | 'hostDefault' | 'hostDefaultAnswered'> {
  const { fromLink, hostNamesTags, tagName, tagLocked, nameReveal, notify, invitePolicy, offers, communityId, myNickname, mastodonInstance, linkMode, showMe, shareCommunity, announcedAt, hostDefault, hostDefaultAnswered } = ev
  return {
    ...(fromLink ? { fromLink } : {}), ...(hostNamesTags !== undefined ? { hostNamesTags } : {}), ...(tagName ? { tagName } : {}), ...(tagLocked ? { tagLocked } : {}), ...(nameReveal ? { nameReveal } : {}),
    ...(notify !== undefined ? { notify } : {}), ...(invitePolicy ? { invitePolicy } : {}), ...(offers ? { offers } : {}),
    ...(communityId ? { communityId } : {}), ...(myNickname ? { myNickname } : {}), ...(mastodonInstance ? { mastodonInstance } : {}), ...(linkMode ? { linkMode } : {}),
    ...(showMe ? { showMe } : {}), ...(shareCommunity ? { shareCommunity } : {}), ...(announcedAt !== undefined ? { announcedAt } : {}),
    ...(hostDefault ? { hostDefault } : {}), ...(hostDefaultAnswered ? { hostDefaultAnswered } : {}),
  }
}

/** The first whitespace-separated word, trimmed. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/** What an event link may say about me: full -> name and did (never the nickname field); first -> the first name only (no did: it would name me fully); nick -> my nickname, else the first name (no did); hidden -> undefined (no name, no did). */
export function revealedBy(by: EventBy | undefined, ev: Pick<TwEvent, 'nameReveal' | 'myNickname'>): EventBy | undefined {
  if (!by) return undefined
  const r = nameRevealOf(ev)
  if (r === 'hidden') return undefined
  const nick = ev.myNickname?.trim() || by.nick?.trim()   // wave 43 answers (iota): my nickname at this event first
  if (r === 'nick' && nick) return { name: nick }
  if (r === 'nick' && NICK_FALLBACK === 'hidden') return undefined
  if (r === 'first' || r === 'nick') { const name = firstName(by.name); return name ? { name } : undefined }
  return { name: by.name, ...(by.did ? { did: by.did } : {}), ...(by.code ? { code: by.code } : {}) }   // hotfix guest-visible
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

/** In my web = sits in one of the four rings (family by its closeness); no ring, unsorted or hidden = not yet. */
export function inWeb(p: Pick<Person, 'ring' | 'fields'>): boolean {
  return RINGS.includes(ringSlot(p))
}

/** The people carrying this event's tag. */
export function attendees(s: AppState, eventId: string): Person[] {
  return s.people.filter((p) => p.events?.includes(eventId))
}

export function tagPerson(s: AppState, personId: string, eventId: string): void {
  const p = s.people.find((x) => x.id === personId)
  if (!p || p.events?.includes(eventId)) return
  p.events = [...(p.events ?? []), eventId]
  const ev = s.events?.find((e) => e.id === eventId)
  joinEventCommunity(s, personId, eventId)
  if (ev?.srv && !ev.hitTagged) { ev.hitTagged = true; sendHit(ev.srv, 'tagged') }
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
  if (!s.events?.some((e) => e.id === linked.id)) {
    s.events = [...(s.events ?? []), { ...ev, createdAt: now, attended: true, fromLink: true }]
    if (ev.srv) sendHit(ev.srv, 'joined')
  }
  return linked.id
}

/** The inviter as a person in my web (Acquaintance, tagged with the event); an existing card with that did or exact name is only tagged. */
export function addInviter(s: AppState, by: EventBy, eventId: string, context: string, id: string, now: number): void {
  const name = by.name.trim()
  const known = s.people.find((p) => (by.did && p.did === by.did) || p.name === name)
  if (known) { if (by.did && !known.did) known.did = by.did; tagPerson(s, known.id, eventId); return }
  s.people.push({ id, name, context, ring: Ring.Acquaintance, metAt: now, lines: [], ...(by.did ? { did: by.did } : {}) })
  tagPerson(s, id, eventId)
}

/** A host link for an event I hold names its tag, unless I keep my own name or do not let the host name it. A peer link never does. */
export function applyHostLink(s: AppState, linked: LinkedEvent): void {
  const mine = s.events?.find((e) => e.id === linked.id)
  if (mine && linked.srv && !mine.srv) mine.srv = linked.srv
  if (mine && linked.kind === 'host' && linked.tagName && !mine.tagLocked && mine.hostNamesTags !== false) mine.tagName = linked.tagName
}

/** What deleteEvent took out, to put back (Undo). */
export interface DeletedEvent { event: TwEvent; tagged: string[] }

export function deleteEvent(s: AppState, eventId: string): DeletedEvent | undefined {
  const event = s.events?.find((e) => e.id === eventId)
  if (!event) return undefined
  const tagged = attendees(s, eventId).map((p) => p.id)
  tagged.forEach((id) => untagPerson(s, id, eventId))
  trashItems(s, 'event', [eventId], Date.now()) // answers-44c: a 30-day tombstone that travels to my devices
  return { event, tagged }
}

export function restoreEvent(s: AppState, d: DeletedEvent): void {
  if (!restoreTrashed(s, 'event', d.event.id)) s.events = [...(s.events ?? []), d.event]
  d.tagged.forEach((id) => tagPerson(s, id, d.event.id))
}

/** Wave 43: the line under the name. Today: "since 09:30 today" (no time: "since today"); any other day: the date span. */
export function sinceLabel(ev: Pick<TwEvent, 'from' | 'to'>, today: string): string {
  if (ev.from.slice(0, 10) !== today) return whenLabel(ev)
  return `since ${ev.from.length > 10 ? `${ev.from.slice(11)} ` : ''}today`
}

/** "until 14 Oct 2026" (with the time when it has one); empty without an end. */
export function untilLabel(ev: Pick<TwEvent, 'to'>): string {
  return ev.to ? `until ${dateLabel(ev.to)}` : ''
}

/** Wave 43: notifications of this event (invitations, feed posts, support asks of the people here); on unless switched off. */
export const notifyOn = eventNotifies

export { isEventHost, mayApprove }

/** Jakob's answer (2026-11-15, beta): hosts, organizers and technical support may edit the event (one predicate; isEventHost already resolves all three roles). */
export const mayEdit = isEventHost

/** One predicate for "show the invite button": hosts always (tech support once it may take over, mayApprove); 'everyone' lets attendees; 'trusted' lets attendees when one of the hosts or organizers sits in my Closest or Close ring (family by its closeness). */
export function mayInvite(ev: TwEvent, s: Pick<AppState, 'me' | 'people'>): boolean {
  if (mayApprove(ev, s.me.displayName, s.people)) return true   // wave 44 (43-D7): technical support invites only once it may take over
  if (!ev.attended) return false
  const policy = ev.invitePolicy ?? DEFAULT_INVITE_POLICY
  if (policy === 'everyone') return true
  if (policy !== 'trusted') return false
  const refs = new Set([...(ev.hosts ?? []), ...eventOrganizers(ev)])
  const names = roleNames(ev, s.people, ['hosts', 'organizers'])
  return s.people.some((p) => (refs.has(p.id) || names.some((h) => sameName(h, p.name))) && TRUSTED_RINGS.includes(ringSlot(p)))
}
const TRUSTED_RINGS: readonly Ring[] = [Ring.Closest, Ring.Close]

/** "12 Oct 2026" for a date, with the time when it has one. */
export function dateLabel(v: string): string {
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}${v.length > 10 ? ` ${v.slice(11)}` : ''}`
}

/** The date span: "12 Oct 2026" or "12 Oct 2026 to 14 Oct 2026". */
export function whenLabel(ev: Pick<TwEvent, 'from' | 'to'>): string {
  return ev.to && ev.to !== ev.from ? `${dateLabel(ev.from)} to ${dateLabel(ev.to)}` : dateLabel(ev.from)
}

/** "Core time 30 Dec – 4 Jan" (no year); empty when the event has no core time. The words sit here, not in strings.ts: strings.ts reaches model.ts, which reaches this file (import cycle). */
export function coreLabel(ev: Pick<TwEvent, 'core'>): string {
  const day = (v: string): string => `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]}`
  return ev.core ? `Core time ${day(ev.core.from)} – ${day(ev.core.to)}` : ''
}

/** "Name · 12 Oct 2026, Vienna" (no place: "Name · 12 Oct 2026") */
export function eventLabel(ev: TwEvent): string {
  return `${ev.name} · ${dateLabel(ev.from)}${ev.where ? `, ${ev.where}` : ''}`
}

/** Today's date in the device's own time zone, YYYY-MM-DD (never the UTC day). */
export function todayIso(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
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
