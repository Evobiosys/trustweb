// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-roster (Jakob 2026-11-23, IYG workshop): people who are connected only to the host (an event with "Everyone can see everyone", or an
 * intimate community) see each other. The host's device names the attendees (events) or the members (community) to each connected recipient as a
 * `seen` envelope (names only, event_envelope.ts); the receiver files them as seen-through people (seen_through.ts).
 * Never in a roster: a person who is off for the event, a deleted or second-hand card, the recipient itself. A name goes to a peer once (AppState.rosterSent). Pure.
 */
import type { AppState, Person, TwEvent } from './model'
import { attendees } from './events'
import { communityOfEvent, listedAttendees } from './event_visibility'
import { isEventHost } from './event_roles'
import { isIntimate, membersOf } from './event_community'
import { mayAnnounce } from './community_event_access'
import { parseCommunity } from './ext/community-mighty/community_data'

export const ROSTER_NAME_MAX = 40
type Rec = Pick<AppState, 'people' | 'me'> & Partial<Pick<AppState, 'extData' | 'events'>>

/** Each name once (case-insensitive), cut to the wire limit, nameless ones left out. */
function named(people: readonly Person[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of people) {
    const n = p.name.trim().slice(0, ROSTER_NAME_MAX)
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
  }
  return out
}
const firstHand = (p: Person): boolean => p.deleted_at === undefined && !p.via

/** The names this device, as a host of `ev`, may tell the people at it: the listed attendees, when the event shows all or belongs to an intimate community. */
export function rosterNames(s: Rec, ev: TwEvent): string[] {
  const tag = communityOfEvent(ev)
  if (!isEventHost(ev, s.me.displayName, s.people) || !(ev.showAll === true || (tag && isIntimate(s, tag)))) return []
  return named(listedAttendees(attendees(s as AppState, ev.id), ev.id, ev.showAll === true).filter(firstHand))
}

/** The members of an intimate community I organize (mode members): the names that go to its connected members. */
export function communityRosterNames(s: Rec, tag: string): string[] {
  const mine = parseCommunity(s.extData?.['community-mighty']).meta?.[tag]?.organizers.includes('me') === true
  return mine && mayAnnounce(s, tag) && isIntimate(s, tag) ? named(membersOf(s, tag)) : []
}

/** The communities this device may roster. */
export const rosterTags = (s: Pick<AppState, 'extData'>): string[] => Object.keys(parseCommunity(s.extData?.['community-mighty']).meta ?? {})

/** What this recipient has not been told yet: never their own name. */
export function rosterDue(sent: readonly string[] | undefined, names: readonly string[], to: string): string[] {
  const have = new Set([...(sent ?? []), to].map((n) => n.trim().toLowerCase()))
  return names.filter((n) => !have.has(n.toLowerCase()))
}
