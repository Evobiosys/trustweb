/** Networks and who curates their field placement. Local data only: no server yet, the network scope is just a key. Pure. */
import type { Curation } from './model'
import { Kind, emptyPlacement, mergePlacements } from './placement'
import type { Placement, Placements } from './placement'

export const DEFAULT_NETWORK = 'my network'

export function emptyCuration(): Curation {
  return { byNetwork: {}, admins: [] }
}

/** Every network the data knows, the default first. */
export function networkNames(c: Curation | undefined): string[] {
  return [...new Set([DEFAULT_NETWORK, ...Object.keys(c?.byNetwork ?? {}), ...(c?.admins ?? []).map((a) => a.networkId)])]
}

/** Networks I admin right now: my own default, plus any period (from..to) set for me (no personId). */
export function adminNetworks(c: Curation | undefined, now: number): string[] {
  const timed = (c?.admins ?? []).filter((a) => !a.personId && a.from <= now && now <= a.to).map((a) => a.networkId)
  return [...new Set([DEFAULT_NETWORK, ...timed])]
}

/** What this device shows: the networks I admin as the base, my own choices on top. */
export function effectivePlacement(kind: Kind, mine: Placements, c: Curation | undefined, now: number): Placement {
  const nets = adminNetworks(c, now).map((n) => c?.byNetwork[n]?.[kind] ?? emptyPlacement())
  return mergePlacements([...nets, mine[kind]])
}
