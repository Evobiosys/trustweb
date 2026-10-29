// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b: zoom levels. Membranes and My Resources show the key part first; a second press on the active tab zooms into everything. Pure, DOM-free. */
import type { AppState, InventoryItem, Person } from './model'
import { Ring } from './model'
import { webSlot } from './rings_layout'

export type ZoomTab = 'web' | 'inventory'
export type Zoom = Readonly<Record<ZoomTab, boolean>>

export const ZOOM_OUT: Zoom = { web: false, inventory: false }
/** Membranes zoomed out: chats and timeline entries count within this many days. */
export const ZOOM_DAYS = 90
/** Fewer people than this after the filter: show everyone, so a small web looks as before. */
export const ZOOM_MIN = 8

export const zoomable = (tab: string): tab is ZoomTab => tab === 'web' || tab === 'inventory'

/** A press on `tab` while `active` is showing: the second press on a zoomable tab zooms in; any other press leaves every zoom. */
export function press(tab: string, active: string): Zoom {
  if (!zoomable(tab)) return ZOOM_OUT
  return tab === active ? { ...ZOOM_OUT, [tab]: true } : ZOOM_OUT
}

/** The Back button: one level up. */
export const back = (): Zoom => ZOOM_OUT

/** People I connect with most: a chat or timeline entry in the last 90 days, or placed on Close or Friend. Under 8 of them: everyone. */
export function connectedPeople<P extends Person>(s: Pick<AppState, 'chats'> & { people: P[] }, now: number): P[] {
  const since = now - ZOOM_DAYS * 86_400_000
  const recent = (p: Person): boolean =>
    (p.peerId ? s.chats?.[p.peerId]?.messages ?? [] : []).some((m) => m.at >= since) || (p.timeline ?? []).some((e) => e.at >= since)
  const kept = s.people.filter((p) => webSlot(p) === Ring.Closest || webSlot(p) === Ring.Close || webSlot(p) === Ring.Friend || recent(p))
  return kept.length < ZOOM_MIN ? s.people : kept
}

export type ItemSort = 'new' | 'az'

/** My Resources zoomed in: search over the text and the notes, newest first or A to Z. */
export function itemRows(items: readonly InventoryItem[], query: string, sort: ItemSort): InventoryItem[] {
  const q = query.trim().toLowerCase()
  const hit = (i: InventoryItem): boolean => !q || i.text.toLowerCase().includes(q) || (i.context ?? []).some((c) => c.text.toLowerCase().includes(q))
  return items.filter(hit).sort((a, b) => (sort === 'az' ? a.text.localeCompare(b.text) : b.createdAt - a.createdAt))
}
