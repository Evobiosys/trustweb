// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 4, Jakob's Tana memo gc_o7RrnYPymdPQ "Improve community event sharing and participant visibility"), the pure rules:
 *  - an INTIMATE community ("everyone knows everyone"): its flag `intimate` in the community settings, default on for up to INTIMATE_MAX members;
 *    its events list the community's members on the event page and, in event mode, on the Web; a big or impersonal one shows only who joins;
 *  - the share audience of a community event: joiners become acquainted community members (the default), or "Choose later" (left as they are);
 *    a personal event has none and keeps today's behaviour;
 *  - the page top: hosted by, who joins (tagged with the event or accepted the invitation; hosts listed above), the first sentence of the description;
 *  - a `joined` acceptance from a connected person (event_envelope.ts) tags them with the event on my device.
 */
import type { AppState, Person, TwEvent } from './model'
import { Ring } from './model'
import { parseCommunity, withMeta } from './ext/community-mighty/community_data'
import { attendees, tagPerson } from './events'
import { communityOfEvent, listedAttendees } from './event_visibility'
import { eventOrganizers } from './event_roles'

/** A community of up to this many members counts as intimate unless its settings say otherwise. */
export const INTIMATE_MAX = 30
const MOD = 'community-mighty'

type Rec = Pick<AppState, 'people'> & Partial<Pick<AppState, 'extData' | 'events' | 'uiRings'>>
const live = (p: Person): boolean => p.deleted_at === undefined && !p.via
const holds = (p: Person, tag: string): boolean => String(p.fields?.[tag]) === 'true'
export const membersOf = (s: Rec, tag: string): Person[] => s.people.filter((p) => live(p) && holds(p, tag))

export function isIntimate(s: Rec, tag: string): boolean {
  const flag = parseCommunity(s.extData?.[MOD]).meta?.[tag]?.intimate
  return typeof flag === 'boolean' ? flag : membersOf(s, tag).length <= INTIMATE_MAX
}

export function setIntimate(s: Pick<AppState, 'extData'>, tag: string, on: boolean): void {
  s.extData = { ...s.extData, [MOD]: withMeta(parseCommunity(s.extData?.[MOD]), tag, { intimate: on }) }
}

export type ShareAudience = 'community' | 'later'
/** Community events: 'community' unless Choose later was picked; a personal event: null (today's default). */
export const shareAudienceOf = (ev: Pick<TwEvent, 'communityId' | 'community' | 'shareAudience'>): ShareAudience | null =>
  communityOfEvent(ev) ? ev.shareAudience ?? 'community' : null
/** The default is not stored. */
export function setShareAudience(ev: Pick<TwEvent, 'shareAudience'>, a: ShareAudience): void {
  if (a === 'later') ev.shareAudience = 'later'; else delete ev.shareAudience
}

/** "Hosted by": the hosts the event names, else its organizers. */
export const hostedBy = (ev: Pick<TwEvent, 'hosts' | 'organizers' | 'organizer'>): string[] => (ev.hosts?.length ? [...ev.hosts] : eventOrganizers(ev))

/** "Joining": the people tagged with the event or who accepted its invitation, as the attendee list shows them, without the hosts (named above). */
export function joiningOf(s: Rec, ev: TwEvent): Person[] {
  const hosts = new Set(hostedBy(ev).map((n) => n.trim().toLowerCase()))
  return listedAttendees(attendees(s as AppState, ev.id), ev.id, ev.showAll === true).filter((p) => live(p) && !hosts.has(p.name.trim().toLowerCase()))
}

/** "Community": an intimate community's members who do not join (yet); empty for a big community or a personal event. */
export function communityRowOf(s: Rec, ev: TwEvent): Person[] {
  const tag = communityOfEvent(ev)
  if (!tag || !isIntimate(s, tag)) return []
  const joining = new Set(joiningOf(s, ev).map((p) => p.id))
  return membersOf(s, tag).filter((p) => !joining.has(p.id))
}

const ONE_LINE_MAX = 140
/** "What this event is": the first sentence of the description, one line. */
export function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  const m = /^.*?[.!?](?=\s|$)/.exec(t)
  const s = m ? m[0] : t
  return s.length > ONE_LINE_MAX ? `${s.slice(0, ONE_LINE_MAX - 1)}…` : s
}

/** Rings a joiner of a community event is lifted out of (never a ring the person was already given). */
const UNPLACED: readonly string[] = [Ring.Unsorted, Ring.None, Ring.Intending]

/**
 * A connected person (`peerId`) accepted the invitation to my event `eventId`: they join it on my device. A community event shared to the
 * community also places them as an acquainted community member (Choose later: left as they are). True when anything changed.
 */
export function applyJoined(s: Pick<AppState, 'people' | 'events'>, peerId: string, eventId: string): boolean {
  const ev = s.events?.find((e) => e.id === eventId)
  const who = s.people.find((p) => p.peerId === peerId && live(p))
  if (!ev || !who || who.events?.includes(eventId)) return false
  const tag = communityOfEvent(ev)
  if (tag && shareAudienceOf(ev) === 'later') { who.events = [...(who.events ?? []), eventId]; return true }   // Choose later: the event only, no community tag
  tagPerson(s as AppState, who.id, eventId)
  if (tag) {
    who.fields = { ...who.fields, [tag]: 'true' }
    if (UNPLACED.includes(who.ring)) who.ring = Ring.Acquaintance
  }
  return true
}

/** The Web in event mode: an intimate community event also shows its community's members (the tag chip; filterByChips keeps any chip's people). */
export function intimateEventChips(s: Rec): string[] {
  const id = s.uiRings?.eventMode
  const ev = id ? s.events?.find((e) => e.id === id) : undefined
  const tag = ev ? communityOfEvent(ev) : undefined
  return tag && isIntimate(s, tag) ? [`tag:${tag}`] : []
}

/** "Message everyone": the connected people joining and the connected hosts (by name), once each. */
export function everyoneAt(s: Pick<AppState, 'people'> & Partial<Pick<AppState, 'extData' | 'events' | 'uiRings'>>, ev: TwEvent): Person[] {
  const hosts = new Set(hostedBy(ev).map((n) => n.trim().toLowerCase()))
  const out = new Map<string, Person>()
  for (const p of [...joiningOf(s, ev), ...s.people.filter((x) => live(x) && hosts.has(x.name.trim().toLowerCase()))]) if (p.peerId) out.set(p.id, p)
  return [...out.values()]
}
