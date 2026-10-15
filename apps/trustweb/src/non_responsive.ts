/** The "non-responsive" person field (wave 8, TrustWeb-only, packages/person-fields tw-non-responsive): greyed in lists, skipped by asks. Pure and DOM-free. */
import type { AppState, Peer, Person } from './model'

export const NON_RESPONSIVE_FIELD = 'tw-non-responsive'

export const isNonResponsive = (p: Pick<Person, 'fields'>): boolean => String(p.fields?.[NON_RESPONSIVE_FIELD]) === 'true'

/** The peers an ask goes to: every connected peer except those whose person is marked non-responsive. */
export function askPeers(s: Pick<AppState, 'peers' | 'people'>): Peer[] {
  const skip = new Set(s.people.filter((p) => p.peerId && isNonResponsive(p)).map((p) => p.peerId))
  return s.peers.filter((peer) => !skip.has(peer.id))
}
