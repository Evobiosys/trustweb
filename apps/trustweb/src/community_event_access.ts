// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 community-events-invite-only: who sees a community's events. Pure, no DOM (the MCP server loads it under plain node).
 *   members  (default) the community's members see its events; a non-member sees one event only when invited personally.
 *   invited  only people invited personally see an event (members too); nothing goes to the community as a whole.
 * No read-only listing and no join prompt for a non-member: an invited non-member gets that one event and nothing else of the community.
 */
import { parseCommunity, withMeta } from './ext/community-mighty/community_data.ts'
import type { AppState, Person, TwEvent } from './model.ts'

export const EVENT_ACCESS = ['members', 'invited'] as const
export type EventAccess = (typeof EVENT_ACCESS)[number]
export const DEFAULT_EVENT_ACCESS: EventAccess = 'members'

const MOD = 'community-mighty'
type Rec = Pick<AppState, 'people'> & Partial<Pick<AppState, 'extData'>>

export const isEventAccess = (v: unknown): v is EventAccess => (EVENT_ACCESS as readonly unknown[]).includes(v)

export function eventAccessOf(s: Partial<Pick<AppState, 'extData'>>, tag: string): EventAccess {
  const v = parseCommunity(s.extData?.[MOD]).meta?.[tag]?.eventAccess
  return isEventAccess(v) ? v : DEFAULT_EVENT_ACCESS
}

export function setEventAccess(s: Partial<Pick<AppState, 'extData'>>, tag: string, mode: EventAccess): void {
  s.extData = { ...s.extData, [MOD]: withMeta(parseCommunity(s.extData?.[MOD]), tag, { eventAccess: mode }) }
}

const holds = (p: Pick<Person, 'fields'>, tag: string): boolean => String(p.fields?.[tag]) === 'true'
/** Invited personally: on the event's invite list, or already joined it. */
export const invitedTo = (ev: Pick<TwEvent, 'id' | 'people'>, p: Pick<Person, 'id' | 'events'>): boolean => !!ev.people?.includes(p.id) || !!p.events?.includes(ev.id)

/** Whether this person sees the event: invited, or (mode members) a member of its community. An event outside any community is not this module's business: true. */
export function seesEvent(s: Partial<Pick<AppState, 'extData'>>, ev: Pick<TwEvent, 'id' | 'people' | 'community' | 'communityId'>, p: Pick<Person, 'id' | 'events' | 'fields'>): boolean {
  const tag = ev.communityId || ev.community
  if (!tag) return true
  return invitedTo(ev, p) || (eventAccessOf(s, tag) === 'members' && holds(p, tag))
}

/** The whole community gets an announcement only in mode members. */
export const mayAnnounce = (s: Partial<Pick<AppState, 'extData'>>, tag: string): boolean => eventAccessOf(s, tag) === 'members'

/** The live people among `ids` who are not members of the community: the ones the "N are not members" warning counts. */
export const nonMembersOf = (s: Rec, tag: string, ids: readonly string[]): Person[] =>
  s.people.filter((p) => ids.includes(p.id) && p.deleted_at === undefined && !p.via && !holds(p, tag))
