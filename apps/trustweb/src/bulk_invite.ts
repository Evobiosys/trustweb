// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 bulk-invite-filter: a filter view for inviting many people to an event at once. Chips `person:<id>` and `tag:<id>` say who to add (Include)
 * and who not (Exclude, wins over Include); the preview is the people left. A community event warns first about the people who are not members of
 * its community (they see the community's events only through this invitation). Pure, no DOM, no runtime imports (the MCP server loads it under plain node); the view is bulk_invite_view.ts, MCP invite_bulk.
 */
import type { TwEvent } from './model'

interface Who { id: string; deleted_at?: string; via?: string; fields?: Record<string, unknown> }
type Rec<P extends Who> = { people: P[] }
const live = (p: Who): boolean => p.deleted_at === undefined && !p.via
const holds = (p: Who, tag: string): boolean => String(p.fields?.[tag]) === 'true'
const hit = (p: Who, chips: readonly string[]): boolean => chips.some((c) => (c.startsWith('person:') ? c.slice(7) === p.id : c.startsWith('tag:') && holds(p, c.slice(4))))

/** Everyone the Include chips name (a person, or whoever holds a tag) minus everyone the Exclude chips name, in record order. No Include chip: nobody. */
export const matching = <P extends Who>(s: Rec<P>, include: readonly string[], exclude: readonly string[]): P[] =>
  include.length ? s.people.filter((p) => live(p) && hit(p, include) && !hit(p, exclude)) : []

/** The people not yet invited to the event. */
export const toInvite = <P extends Who>(s: Rec<P>, ev: Pick<TwEvent, 'people'>, include: readonly string[], exclude: readonly string[]): P[] =>
  matching(s, include, exclude).filter((p) => !ev.people?.includes(p.id))

/** The community of a community event and the people of `who` who do not hold its tag; null community for a personal event. */
export function nonMembers<P extends Who>(who: readonly P[], ev: Pick<TwEvent, 'communityId' | 'community'>): { community: string | null; people: P[] } {
  const community = ev.communityId || ev.community || null
  return { community, people: community ? who.filter((p) => !holds(p, community)) : [] }
}
