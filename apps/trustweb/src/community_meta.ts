// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-guest-path: what a guest's phone needs to treat a community as one: selected, named, its organizer recorded, its events marked.
 * The organizer's device sends it (`comm` envelope, event_envelope.ts); an invite link from an organizer sets the same at the join. Pure.
 * Gates: only a person who holds the tag on my device; the first organizer only from the first person I met in it (the one I joined through),
 * later changes only from a recorded organizer. Names are cut to 40, own names only (the announced name rides nowhere else here).
 */
import type { AppState, Person } from './model'
import { metaOf, parseCommunity, withMeta } from './ext/community-mighty/community_data'
import { isIntimate } from './event_community'
import { isEventHost } from './event_roles'
import { communityOfEvent } from './event_visibility'

/** The wire form (types.ts EventEnvelope.comm): `ev` = the community's events the sender hosts. */
export interface CommMeta { tag: string; name?: string; intimate?: boolean; ev: string[] }
export const COMM_NAME_MAX = 40
export const COMM_EVENTS_MAX = 50
const MOD = 'community-mighty'
type Rec = Pick<AppState, 'people' | 'me'> & Partial<Pick<AppState, 'extData' | 'events'>>

const holds = (p: Person, tag: string): boolean => String(p.fields?.[tag]) === 'true'
const firstHand = (p: Person): boolean => p.deleted_at === undefined && !p.via

/** The data the organizer's device tells a member about `tag`; null unless I organize it. */
export function commOut(s: Rec, tag: string, name?: string): CommMeta | null {
  const m = parseCommunity(s.extData?.[MOD]).meta?.[tag]
  if (!m?.organizers.includes('me')) return null
  const nm = (name ?? m.name)?.slice(0, COMM_NAME_MAX)
  const ev = (s.events ?? []).filter((e) => communityOfEvent(e) === tag && isEventHost(e, s.me.displayName, s.people)).map((e) => e.id).slice(0, COMM_EVENTS_MAX)
  return { tag, ...(nm ? { name: nm } : {}), intimate: isIntimate(s, tag), ev }
}

/** A connected person's community data lands on my device when the gates hold. True when anything changed. */
export function applyComm(s: Rec, sender: Person, c: CommMeta): boolean {
  if (!firstHand(sender) || !holds(sender, c.tag)) return false
  const d = parseCommunity(s.extData?.[MOD])
  const known = d.meta?.[c.tag]?.organizers ?? []
  const first = s.people.filter((p) => firstHand(p) && holds(p, c.tag)).reduce<Person | undefined>((a, p) => (!a || p.metAt < a.metAt ? p : a), undefined)
  if (known.length ? !known.includes(sender.id) : first?.id !== sender.id) return false
  const name = c.name?.slice(0, COMM_NAME_MAX)
  const next = parseCommunity(withMeta({ ...d, tag: d.tag ?? c.tag }, c.tag, { kind: 'managed', organizers: [...new Set([...known, sender.id])], ...(name ? { name } : {}), ...(typeof c.intimate === 'boolean' ? { intimate: c.intimate } : {}) }))
  let changed = JSON.stringify(next) !== JSON.stringify(d)
  if (changed) s.extData = { ...s.extData, [MOD]: next }
  for (const id of c.ev.slice(0, COMM_EVENTS_MAX)) {
    const e = s.events?.find((x) => x.id === id)
    if (e && !communityOfEvent(e) && isEventHost(e, sender.name, s.people)) { e.communityId = c.tag; changed = true }
  }
  return changed
}

/** The invite was accepted: the community becomes the chosen one when none is, and an inviter who organizes it is recorded as its organizer. */
export function joinedCommunity(s: Rec, tag: string, label: string, inviter: Person, organizer: boolean): void {
  let d = parseCommunity(s.extData?.[MOD])
  if (!d.tag) d = { ...d, tag }
  if (organizer) d = withMeta(d, tag, { kind: 'managed', organizers: [...new Set([...metaOf(d, tag).organizers, inviter.id])], name: label.slice(0, COMM_NAME_MAX) })
  s.extData = { ...s.extData, [MOD]: d }
}
