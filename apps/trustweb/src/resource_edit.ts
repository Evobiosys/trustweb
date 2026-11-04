// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 (person card): rename a resource and add one inside a category, right where the card lists them. Pure. */
import { Audience } from './model'
import type { AppState, InventoryItem } from './model'
import { typedSource } from './provenance'
import type { VisibleCategory } from './zone_visibility'

/** A resource's title is capped like a card name field: long enough for a sentence, short enough for one row. */
export const RESOURCE_TITLE_MAX = 120

/** The title a rename saves, or null when nothing should be saved (empty or unchanged: the old title stays). */
export function renamedResource(current: string, typed: string): string | null {
  const next = typed.trim().slice(0, RESOURCE_TITLE_MAX)
  return next && next !== current ? next : null
}

/** Saves a new title on resource `id`; false when nothing changed (renamedResource rule, or no such resource). */
export function renameResource(rec: Pick<AppState, 'inventory'>, id: string, next: string): boolean {
  const item = rec.inventory.find((i) => i.id === id)
  const title = item && renamedResource(item.text, next)
  if (!item || !title) return false
  item.text = title
  return true
}

/** Who a new resource in `category` is visible to: the same as the others there. Web: everyone; a tag: only that tag (rings closed, I9); the zone: as its first resource. */
export function categoryAudience(category: Pick<VisibleCategory, 'key' | 'items'>): Audience {
  if (category.key === 'web') return Audience.FriendsOfFriends
  if (category.key.startsWith('tag:')) return Audience.OnlyMe
  return category.items[0]?.audience ?? Audience.Friends
}

/** Adds a typed resource to `category` (same audience as the rest of it); null for an empty title. */
export function addResourceIn(rec: Pick<AppState, 'inventory'>, category: Pick<VisibleCategory, 'key' | 'items'>, title: string, id: string, now: number): InventoryItem | null {
  const text = renamedResource('', title)
  if (!text) return null
  const item: InventoryItem = {
    id, text, audience: categoryAudience(category), included: true, createdAt: now, source: typedSource(),
    ...(category.key.startsWith('tag:') ? { tagAudience: [category.key.slice(4)] } : {}),
  }
  rec.inventory.push(item)
  return item
}
