// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-people-picker-2: the rules of a scan, pure and DOM-free. A scan offers the zones "acquainted or closer" only (never "Intending to connect");
 * the zone a scanner is placed in is the one chosen under my own code; a person already connected is not added a second time.
 * No runtime imports and no enums: apps/mcp loads this file under plain node (type stripping), so the zones are written as their string values.
 */
import type { AppState, Person, Ring } from './model'

/** The zone choices after a scan and under my own code: Closest few down to Acquaintances (RINGS without Intending). */
export const SCAN_RINGS = ['closest', 'close', 'friend', 'acquaintance'] as unknown as readonly Ring[]

const ACQUAINTANCE = 'acquaintance' as unknown as Ring

/** A ring a scan may use: Intending (or anything outside the list) becomes Acquaintances. */
export const scanRing = (r: Ring): Ring => (SCAN_RINGS.includes(r) ? r : ACQUAINTANCE)

/** The zone for a person who scans my code: my choice when it is one of the scan zones, else the default zone. */
export const placementOf = (s: Pick<AppState, 'connectPlacement'>, dflt: Ring): Ring => (s.connectPlacement && SCAN_RINGS.includes(s.connectPlacement) ? s.connectPlacement : dflt)

/** The person I already hold for this DID (a connected peer's card), else undefined. */
export function connectedPerson(s: Pick<AppState, 'people' | 'peers'>, did: string): Person | undefined {
  const peer = s.peers.find((p) => p.did === did)
  return peer ? s.people.find((p) => p.peerId === peer.id) : undefined
}
