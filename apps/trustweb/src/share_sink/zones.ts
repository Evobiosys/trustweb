// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 23 (share sink): TrustWeb's adaptation of Social-Fabric's TrustZones, list v1.2.2 (Jakob 2026-10-27, Q1), used everywhere:
 * app, platforms, sharing layer. Outer to inner; a higher rank is more intimate. A user may switch rings off (`active`); public and
 * self cannot be switched off. A person in several zones gets the most intimate one (community + close ally -> close ally).
 *
 *   app Ring (model.ts)      ladder Zone
 *   ---------------------    -----------------------------------------------
 *   None, Unsorted           public        (strangers / public)
 *   Intending                intending     (intending to connect: strangers yet/still)
 *   Acquaintance             acquaintance
 *   (no ring yet)            community     (who I met before)
 *   Friend                   friend
 *   Close                    close         (close friends / allies)
 *   (no ring yet)            closest       (closest few)
 *   Family                   by its closeness (fields[CLOSENESS_KEY], Close when unset; ringSlot)
 *   (the owner)              self          (self / root)
 */
import { Ring, ringSlot, type Person } from '../model'

export enum Zone {
  Public = 'public',
  Intending = 'intending',
  Acquaintance = 'acquaintance',
  Community = 'community',
  Friend = 'friend',
  Close = 'close',
  Closest = 'closest',
  Self = 'self',
}

/** Outer to inner; the index is the rank. */
export const LADDER: readonly Zone[] = [Zone.Public, Zone.Intending, Zone.Acquaintance, Zone.Community, Zone.Friend, Zone.Close, Zone.Closest, Zone.Self]
export const ALL_ZONES: readonly Zone[] = LADDER

export const rank = (z: Zone): number => LADDER.indexOf(z)
export const isZone = (s: string): s is Zone => (LADDER as readonly string[]).includes(s)

const on = (z: Zone, active: readonly Zone[]): boolean => z === Zone.Public || z === Zone.Self || active.includes(z)

/** The innermost of a person's zones among the rings switched on; public when none is. */
export function mostIntimate(zones: readonly Zone[], active: readonly Zone[] = ALL_ZONES): Zone {
  return zones.filter((z) => on(z, active)).reduce((a, b) => (rank(b) > rank(a) ? b : a), Zone.Public)
}

/** An item shared to a ring that is off moves one ring in (to the next ring on), never out (I9). */
export function effectiveZone(z: Zone, active: readonly Zone[] = ALL_ZONES): Zone {
  return LADDER.slice(rank(z)).find((x) => on(x, active)) as Zone
}

const FROM_RING: Record<string, Zone> = {
  [Ring.None]: Zone.Public, [Ring.Unsorted]: Zone.Public, [Ring.Intending]: Zone.Intending,
  [Ring.Acquaintance]: Zone.Acquaintance, [Ring.Friend]: Zone.Friend, [Ring.Close]: Zone.Close,
}

/** The ladder zone of a person in the app's web (table above). */
export const zoneOfPerson = (p: Pick<Person, 'ring' | 'fields'>): Zone => FROM_RING[ringSlot(p)]
