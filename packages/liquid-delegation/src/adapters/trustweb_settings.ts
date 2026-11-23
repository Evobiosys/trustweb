// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** TrustWeb adapter: follow a person's settings group, directly or friend-of-friend. Ports keep the module free of TrustWeb imports. */
import { resolve, type Delegation, type Resolution } from '../delegation.ts'

export interface TrustPorts {
  /** The trust zone in which `viewer` holds `target`, or null when unknown. */
  zoneOf(viewer: string, target: string): string | null
  /** Zones from closest outward (TrustWeb: ZONES). */
  order: readonly string[]
}
export interface FollowOptions { reach: string; maxDepth?: number; now?: number }

/** Is `target` within the `reach` zone of `viewer` (closest..reach)? */
export function within(ports: TrustPorts, viewer: string, target: string, reach: string): boolean {
  const z = ports.zoneOf(viewer, target)
  const lim = ports.order.indexOf(reach)
  return z !== null && lim >= 0 && ports.order.indexOf(z) >= 0 && ports.order.indexOf(z) <= lim
}

/** Resolves who counts for `from`: only delegations whose target lies within the delegator's reach zone are followed. */
export function followChain(book: readonly Delegation[], from: string, topic: string, ports: TrustPorts, o: FollowOptions): Resolution {
  const reachable = book.filter((x) => within(ports, x.from, x.to, o.reach))
  return resolve(reachable, from, topic, o.maxDepth, o.now)
}
