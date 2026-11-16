// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c sync-devices: one person, several devices. Each of my devices has its own relay identity (DID), so a connection made on the laptop
 * knows only the laptop's DID and would drop a message my phone sends. The device that made a connection therefore tells it, in a sealed
 * 'devices' envelope (apps/demo wire.ts), the DIDs of my other linked devices; the receiver keeps them as that connection's `alsoDids`, finds
 * the connection by any of them (net.ts) and sends chat text to all of them. Only the sealed channel of an existing connection can add a DID,
 * and never one that is another connection's own or one of mine. Pure, no DOM.
 */
import type { Peer } from './model'

export const ALSO_DIDS_MAX = 8
const DID_RE = /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/

/** The connection a wire from `did` belongs to: its own DID first, then the other devices it told me. */
export function peerForDid(peers: readonly Peer[], did: string): Peer | undefined {
  return peers.find((p) => p.did === did) ?? peers.find((p) => p.alsoDids?.includes(did))
}

/** Every DID a message to this connection goes to: its own first. */
export const didsOf = (p: Pick<Peer, 'did' | 'alsoDids'>): string[] => [p.did, ...(p.alsoDids ?? [])]

/** Adds the told DIDs to `peer.alsoDids` (well-formed, new, no other connection's own, not `mine`), at most ALSO_DIDS_MAX. True when any was added. */
export function addAlsoDids(peers: readonly Peer[], peer: Peer, dids: readonly string[], mine: readonly string[]): boolean {
  const taken = new Set([...peers.map((p) => p.did), ...mine])
  const have = peer.alsoDids ?? []
  const add = [...new Set(dids)].filter((d) => DID_RE.test(d) && !taken.has(d) && !have.includes(d))
  const next = [...have, ...add].slice(0, ALSO_DIDS_MAX)
  if (next.length === have.length) return false
  peer.alsoDids = next
  return true
}

/** The marker a connection keeps of which set of my devices it was told. */
export const toldKey = (dids: readonly string[]): string => [...dids].sort().join(' ')

/** Connections made on this device whose told set differs from `myDevices` (my other devices' DIDs). None while I have no other device. */
export function devicesToTell(peers: readonly Peer[], myDevices: readonly string[]): Peer[] {
  if (!myDevices.length) return []
  const key = toldKey(myDevices)
  return peers.filter((p) => !p.synced && p.toldDevices !== key)
}
