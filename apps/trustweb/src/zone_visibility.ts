// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 (card page): which of my resources one person sees, grouped by the category that grants it. Pure. */
import { Audience, Provenance, audienceAdmits } from './model'
import type { InventoryItem, Ring } from './model'

export interface VisibleCategory { key: string; label: string; items: InventoryItem[] }

/**
 * The resources a person held in `ring` with `personTags` sees, as the cascade admits them at the first hop (cascade.ts itemAdmits):
 * the zone itself (a ring audience), everyone in the web (the widest audience) and one category per tag. An item that two
 * categories grant sits under both; `count` counts it once. Empty categories are left out.
 */
export function visibleVia(
  inventory: readonly InventoryItem[],
  ring: Ring,
  personTags: readonly { id: string; label?: string }[],
  labels: { zone: string; web: string },
): { count: number; categories: VisibleCategory[] } {
  const categories: VisibleCategory[] = [
    { key: 'zone', label: labels.zone, items: [] },
    { key: 'web', label: labels.web, items: [] },
    ...personTags.map((t) => ({ key: `tag:${t.id}`, label: t.label ?? t.id, items: [] as InventoryItem[] })),
  ]
  const seen = new Set<string>()
  for (const i of inventory) {
    if (!i.included) continue
    if (audienceAdmits(i.audience, ring)) categories[i.audience === Audience.FriendsOfFriends ? 1 : 0].items.push(i)
    personTags.forEach((t, n) => { if (i.tagAudience?.includes(t.id)) categories[n + 2].items.push(i) })
  }
  const shown = categories.filter((c) => c.items.length > 0)
  shown.forEach((c) => c.items.forEach((i) => seen.add(i.id)))
  return { count: seen.size, categories: shown }
}

/** The separator before name `i` of `n`: "" first, " and " in a pair, ", " between, ", and " before the last of three or more. */
export const andSep = (i: number, n: number): string => (i === 0 ? '' : i === n - 1 ? (n === 2 ? ' and ' : ', and ') : ', ')

/** "X", "X and Y", "X, Y, and Z": the and only before the last. */
export const andJoin = (names: readonly string[]): string => names.map((x, i) => andSep(i, names.length) + x).join('')

/** The strings.ts cardSharesKind key of a resource's provenance; none known: typed (what everything before provenance was). */
export function kindKey(kind: Provenance | undefined): 'recorded' | 'typed' | 'imported' | 'shared' | 'demo' {
  switch (kind) {
    case Provenance.RecordedSolo: case Provenance.RecordedMeeting: return 'recorded'
    case Provenance.Tana: case Provenance.Local: return 'imported'
    case Provenance.SharedByPerson: return 'shared'
    case Provenance.Demo: return 'demo'
    default: return 'typed'
  }
}
