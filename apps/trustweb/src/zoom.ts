// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b/25: zoom levels. My Resources shows the key part first; a second press on the active tab zooms into everything (Membranes no longer zooms). Pure, DOM-free. */
import type { InventoryItem } from './model'

export type ZoomTab = 'inventory'
export type Zoom = Readonly<Record<ZoomTab, boolean>>

export const ZOOM_OUT: Zoom = { inventory: false }

export const zoomable = (tab: string): tab is ZoomTab => tab === 'inventory'

/** A press on `tab` while `active` is showing: the second press on a zoomable tab zooms in; any other press leaves every zoom. */
export function press(tab: string, active: string): Zoom {
  if (!zoomable(tab)) return ZOOM_OUT
  return tab === active ? { ...ZOOM_OUT, [tab]: true } : ZOOM_OUT
}

/** The Back button: one level up. */
export const back = (): Zoom => ZOOM_OUT

export type ItemSort = 'new' | 'az'

/** My Resources zoomed in: search over the text and the notes, newest first or A to Z. */
export function itemRows(items: readonly InventoryItem[], query: string, sort: ItemSort): InventoryItem[] {
  const q = query.trim().toLowerCase()
  const hit = (i: InventoryItem): boolean => !q || i.text.toLowerCase().includes(q) || (i.context ?? []).some((c) => c.text.toLowerCase().includes(q))
  return items.filter(hit).sort((a, b) => (sort === 'az' ? a.text.localeCompare(b.text) : b.createdAt - a.createdAt))
}
