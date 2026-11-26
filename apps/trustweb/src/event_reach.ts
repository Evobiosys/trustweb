// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * hotfix guest-visible (2026-11-26): an event link says whom it came from (`by`: name, did, connect code). A joiner who does not hold that person yet
 * connects to them when it accepts, so the host hears of the join (events.ts joined) and tells the other guests. Pure.
 */
import type { Person } from './model'
import { CONNECT_CODE_RE } from './connect_code'
import type { EventBy } from './event_link'

/** What to connect to (a did, else a connect code), or null: no way to reach the inviter, or I hold them already: a card with a connection whose did (or other device) is the link's did, else (a link without a did) the same name. */
export function hostToReach(by: EventBy | undefined, s: { people: readonly Pick<Person, 'name' | 'peerId' | 'deleted_at'>[]; peers: readonly { id: string; did: string; alsoDids?: string[] }[] }): string | null {
  const how = by?.did ?? by?.code
  if (!by || !how) return null
  const live = s.people.filter((p) => p.peerId && p.deleted_at === undefined)
  const didOf = (peerId: string | undefined, did: string): boolean => s.peers.some((x) => x.id === peerId && (x.did === did || x.alsoDids?.includes(did) === true))
  const held = by.did !== undefined ? live.some((p) => didOf(p.peerId, by.did as string)) : live.some((p) => p.name.trim() === by.name.trim())
  return held ? null : how
}

/** F7: my connect code as an event link may carry it: a readable code of this device that the server still accepts (not a linked device's, not stale). */
export function ownReachCode(s: { connectCode?: { code: string; owner?: 'this' | 'other'; stale?: true } }): string | undefined {
  const c = s.connectCode
  return c && c.owner !== 'other' && !c.stale && CONNECT_CODE_RE.test(c.code) ? c.code : undefined
}

/** F9: whom a link I share names. A guest copy (came in through a link) names the host it came from with that host's own reach, never my code as the host's; a copy that holds none names me without a code. */
export function byForLink(ev: { fromLink?: true; by?: EventBy }, mine: EventBy | undefined): EventBy | undefined {
  if (!ev.fromLink) return mine
  if (ev.by) return { name: ev.by.name, ...(ev.by.did ? { did: ev.by.did } : {}), ...(ev.by.code ? { code: ev.by.code } : {}) }
  if (!mine) return undefined
  const { code: _code, ...rest } = mine
  return rest
}
