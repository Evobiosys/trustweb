/** The "non-responsive" person field (wave 8, TrustWeb-only, packages/person-fields tw-non-responsive): greyed in lists, skipped by asks. Pure and DOM-free. */
import type { AppState, Peer, Person } from './model'

export const NON_RESPONSIVE_FIELD = 'tw-non-responsive'

export const isNonResponsive = (p: Pick<Person, 'fields'>): boolean => String(p.fields?.[NON_RESPONSIVE_FIELD]) === 'true'

/** Wave 15: a blocked person is skipped everywhere a non-responsive one is, and more (net.ts, main.ts). */
export const isBlocked = (p: Pick<Person, 'blocked'> | undefined): boolean => (p?.blocked ?? 0) > 0

/** The peers an ask goes to: every connected peer except those whose person is marked non-responsive or blocked. */
export function askPeers(s: Pick<AppState, 'peers' | 'people'>): Peer[] {
  const skip = new Set(s.people.filter((p) => p.peerId && (isNonResponsive(p) || isBlocked(p))).map((p) => p.peerId))
  return s.peers.filter((peer) => !skip.has(peer.id))
}
