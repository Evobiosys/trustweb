// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b: the TrustZones tag filters. Chips are `person:<id>` or `tag:<id>` (share_page.ts candidates). "Show only" keeps what matches any chip (empty = everyone); "hide" removes what matches any chip and wins. Pure. */
import type { Person } from './model'
import { type ColourTag, tagsOf } from './colour_tags'

export function filterByChips<P extends Pick<Person, 'id' | 'ring' | 'fields'>>(people: readonly P[], tags: readonly ColourTag[], show: readonly string[], hide: readonly string[]): P[] {
  const hit = (p: P, chips: readonly string[]): boolean => chips.includes('person:' + p.id) || tagsOf(p, tags).some((t) => chips.includes('tag:' + t.id))
  return people.filter((p) => (!show.length || hit(p, show)) && !hit(p, hide))
}
