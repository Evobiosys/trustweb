// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-roster (Jakob 2026-11-23, IYG workshop): people who are connected only to the host (an event with "Everyone can see everyone", or an
 * intimate community) see each other. The host's device names the attendees (events) or the members (community) to each connected recipient as a
 * `seen` envelope (names only, event_envelope.ts); the receiver files them as seen-through people (seen_through.ts).
 * Never in a roster: a person who is off for the event, a deleted or second-hand card, the recipient itself. A name goes to a peer once (AppState.rosterSent). Pure.
 */
import type { AppState, Person, TwEvent } from './model'
import { attendees } from './events'
import { DEFAULT_EVENT_VISIBILITY, communityOfEvent, isVisibility } from './event_visibility'
import { isEventHost } from './event_roles'
import { isIntimate, membersOf } from './event_community'
import { mayAnnounce } from './community_event_access'
import { ownName } from './own_name' // wave46 iyg-reviewfix D1/D2
import { parseCommunity } from './ext/community-mighty/community_data'

export const ROSTER_NAME_MAX = 40
/** wave46 iyg-reviewfix F10: how many rosters were really computed (a perf guard in the tests counts it; a save that changed nothing computes none). */
export const rosterWork = { names: 0 }
type Rec = Pick<AppState, 'people' | 'me'> & Partial<Pick<AppState, 'extData' | 'events' | 'peers'>>

/** Each name once (case-insensitive), cut to the wire limit. D1: only people connected to me at least once (a peerId), never a plain tagged contact. D2: the name each announced themselves, never my label; none announced = left out. */
function named(s: Rec, people: readonly Person[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of people) {
    const n = ownName(s, p).slice(0, ROSTER_NAME_MAX)
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
  }
  return out
}
const firstHand = (p: Person): boolean => p.deleted_at === undefined && !p.via

/** wave46 iyg-reviewfix F1: a guest who never announced a mode counts as the default (discoverable): listed under showAll only; off never. The host's own attendee list (listedAttendees) is unchanged. */
const rosterMode = (p: Person, id: string): string => (isVisibility(p.eventShow?.[id]) ? p.eventShow![id] : DEFAULT_EVENT_VISIBILITY)
const rosterListed = (p: Person, id: string, showAll: boolean): boolean => (showAll ? rosterMode(p, id) !== 'off' : rosterMode(p, id) === 'open')

/** The names this device, as a host of `ev`, may tell the people at it: the listed attendees, when the event shows all or belongs to an intimate community. */
export function rosterNames(s: Rec, ev: TwEvent): string[] {
  rosterWork.names++
  const tag = communityOfEvent(ev)
  if (!isEventHost(ev, s.me.displayName, s.people) || !(ev.showAll === true || (tag && isIntimate(s, tag)))) return []
  return named(s, attendees(s as AppState, ev.id).filter((p) => rosterListed(p, ev.id, ev.showAll === true) && firstHand(p)))
}

/** The members of an intimate community I organize (mode members): the names that go to its connected members. */
export function communityRosterNames(s: Rec, tag: string): string[] {
  rosterWork.names++
  const mine = parseCommunity(s.extData?.['community-mighty']).meta?.[tag]?.organizers.includes('me') === true
  return mine && mayAnnounce(s, tag) && isIntimate(s, tag) ? named(s, membersOf(s, tag)) : []
}

/** The communities this device may roster. */
export const rosterTags = (s: Pick<AppState, 'extData'>): string[] => Object.keys(parseCommunity(s.extData?.['community-mighty']).meta ?? {})

/** wave46 iyg-reviewfix F10: everything a roster is made of, in one cheap pass: a save that leaves it equal skips the whole sync. */
export function rosterSignature(s: Rec & Partial<Pick<AppState, 'peers'>>): string {
  const p = s.people.map((x) => `${x.id}|${x.name}|${x.peerId ?? ''}|${x.deleted_at ?? ''}|${x.via ?? ''}|${x.events?.join(',') ?? ''}|${JSON.stringify(x.eventShow ?? '')}|${JSON.stringify(x.fields ?? '')}`).join('\n')
  const e = (s.events ?? []).map((x) => `${x.id}|${x.showAll ?? ''}|${x.communityId ?? ''}|${x.community ?? ''}|${x.fromLink ?? ''}|${x.hosts?.join(',') ?? ''}|${x.people?.join(',') ?? ''}|${x.organizers?.join(',') ?? ''}`).join('\n')
  return [s.me.displayName, p, e, (s.peers ?? []).map((x) => `${x.id}|${x.displayName}`).join(','), JSON.stringify(s.extData?.['community-mighty'] ?? '')].join('\n#\n')
}

/** What this recipient has not been told yet: never their own name. */
export function rosterDue(sent: readonly string[] | undefined, names: readonly string[], to: string): string[] {
  const have = new Set([...(sent ?? []), to].map((n) => n.trim().toLowerCase()))
  return names.filter((n) => !have.has(n.toLowerCase()))
}

/** F5: who hears the roster of `ev`: the people who joined it (tagged), never an invitee who did not. */
export function rosterAudience(s: Pick<AppState, 'people'>, ev: TwEvent): Person[] {
  return attendees(s as AppState, ev.id)
}
