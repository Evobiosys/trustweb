// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b: the TrustZones tag filters. Chips are `person:<id>` or `tag:<id>` (share_page.ts candidates). "Show only" keeps what matches any chip (empty = everyone); "hide" removes what matches any chip and wins. Pure. */
import type { Person } from './model'
import { type ColourTag, memberIds } from './colour_tags'

export function filterByChips<P extends Pick<Person, 'id' | 'ring' | 'fields'>>(people: readonly P[], tags: readonly ColourTag[], show: readonly string[], hide: readonly string[]): P[] {
  // Wave 40: a tag chip means the tag's resolved members (a group holds its children's people).
  const members = new Map<string, Set<string>>()
  const inTag = (p: P, id: string): boolean => {
    if (!members.has(id)) members.set(id, new Set(memberIds(people, tags, id)))
    return members.get(id)?.has(p.id) === true
  }
  const hit = (p: P, chips: readonly string[]): boolean => chips.some((c) => (c.startsWith('person:') ? c === 'person:' + p.id : c.startsWith('tag:') && inTag(p, c.slice(4))))
  return people.filter((p) => (!show.length || hit(p, show)) && !hit(p, hide))
}
