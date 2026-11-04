// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: the TrustZones view's "Connections between my contacts": the Network view's member-to-member edges (network_graph.ts knowsLinks) without any edge touching me. */
import { knowsLinks } from './network_graph'
import type { Person } from './model'

/** Node 0 is me (knowsLinks): every edge touching it goes. */
export const withoutMe = (links: readonly (readonly [number, number, boolean])[]): [number, number, boolean][] =>
  links.filter(([a, b]) => a !== 0 && b !== 0).map(([a, b, mutual]) => [a, b, mutual])

/** The contact pairs to draw, as person ids. */
export function contactPairs(meId: string, people: readonly Person[]): [string, string][] {
  return withoutMe(knowsLinks(meId, people)).map(([a, b]) => [people[a - 1].id, people[b - 1].id])
}

export { connectionsOn as connectionsShown } from './filter_groups'
