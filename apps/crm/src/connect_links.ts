// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A12: sets or clears one messenger link on a person of the Curator's record copy and hands the result to the host's record. */
import type { Person } from '../../trustweb/src/model'
import { setLink } from '../../trustweb/src/person_links'
import type { LinkKind } from '../../trustweb/src/person_links'

export function saveLink(people: Person[], host: { setLinks?(personId: string, links: Person['links']): void }, personId: string, kind: LinkKind, raw: string): boolean {
  const p = people.find((x) => x.id === personId)
  if (!p || !setLink(p, kind, raw)) return false
  host.setLinks?.(personId, p.links)
  return true
}
