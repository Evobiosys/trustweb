// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * hotfix guest-visible (2026-11-26): an event link says whom it came from (`by`: name, did, connect code). A joiner who does not hold that person yet
 * connects to them when it accepts, so the host hears of the join (events.ts joined) and tells the other guests. Pure.
 */
import type { Person } from './model'
import type { EventBy } from './event_link'

/** What to connect to (a did, else a connect code), or null: no way to reach the inviter, or I hold them already (a card with a connection, by did or by the same name). */
export function hostToReach(by: EventBy | undefined, s: { people: readonly Pick<Person, 'name' | 'peerId' | 'deleted_at'>[]; peers: readonly { id: string; did: string }[] }): string | null {
  const how = by?.did ?? by?.code
  if (!by || !how) return null
  const held = s.people.some((p) => p.peerId && p.deleted_at === undefined && (p.name.trim() === by.name.trim() || (by.did !== undefined && s.peers.some((x) => x.id === p.peerId && x.did === by.did))))
  return held ? null : how
}
