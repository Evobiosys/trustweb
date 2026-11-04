// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31: the configurable bottom bar. Stored as AppState.uiBar {order, hidden, primary}; absent = the default
 * (Ask your web, Resources, Web, Feed, Record, Chat, Events). Record cannot be hidden and is the primary (raised)
 * button unless another shown view is chosen. A view this build does not know, or whose feature is off, is skipped.
 * On a phone at most PHONE_MAX buttons show; the rest live in the ⋮ sheet. Pure, no DOM.
 */
export type BarId = 'ask' | 'inventory' | 'web' | 'feed' | 'record' | 'chat' | 'events' | 'network' | 'people' | 'map'

export interface UiBar {
  order?: string[]
  hidden?: string[]
  primary?: string
}

export interface BarFlags {
  events: boolean
  feed: boolean
  inventory: boolean
  people: boolean
  map: boolean
}

export const DEFAULT_ORDER: readonly BarId[] = ['ask', 'inventory', 'web', 'feed', 'record', 'chat', 'events']
export const PHONE_MAX = 6

/** The sheet's checklist, in its order (Record is always on and not listed). */
const CHOICES: readonly BarId[] = ['web', 'feed', 'chat', 'events', 'inventory', 'ask', 'network', 'people', 'map']

function offered(f: BarFlags): BarId[] {
  const off: Partial<Record<BarId, boolean>> = { events: !f.events, feed: !f.feed, inventory: !f.inventory, people: !f.people, map: !f.map }
  return (['record', ...CHOICES] as BarId[]).filter((id) => !off[id])
}

/** The saved order (or the default) with Record in it, unknown ids and duplicates dropped; Record lands mid-row when missing. */
function baseOrder(bar: UiBar | undefined): BarId[] {
  const known = new Set<string>(['record', ...CHOICES])
  const saved = Array.isArray(bar?.order) ? bar.order : DEFAULT_ORDER
  const order = [...new Set(saved)].filter((id): id is BarId => typeof id === 'string' && known.has(id))
  if (!order.includes('record')) order.splice(Math.ceil(order.length / 2), 0, 'record')
  return order
}

export function resolveBar(bar: UiBar | undefined, f: BarFlags): { ids: BarId[]; primary: BarId } {
  const ok = new Set<string>(offered(f))
  const hidden = new Set<unknown>(Array.isArray(bar?.hidden) ? bar.hidden : [])
  const ids = baseOrder(bar).filter((id) => ok.has(id) && (id === 'record' || !hidden.has(id)))
  const primary = ids.includes(bar?.primary as BarId) ? (bar?.primary as BarId) : 'record'
  return { ids, primary }
}

/** Every view the sheet offers, with whether it sits in the bar now. */
export function barChoices(bar: UiBar | undefined, f: BarFlags): { id: BarId; on: boolean }[] {
  const { ids } = resolveBar(bar, f)
  return offered(f).filter((id) => id !== 'record').map((id) => ({ id, on: ids.includes(id) }))
}

/** Shows the view if it is hidden or new, hides it if shown. Record and unknown ids change nothing. Hiding the primary hands it back to Record. */
export function toggleBar(bar: UiBar | undefined, id: string, f: BarFlags): UiBar | undefined {
  if (!offered(f).includes(id as BarId) || id === 'record') return bar
  const on = resolveBar(bar, f).ids.includes(id as BarId)
  const order = baseOrder(bar)
  const hidden = (bar?.hidden ?? []).filter((h) => h !== id)
  if (!on && !order.includes(id as BarId)) order.push(id as BarId)
  const next: UiBar = { order, hidden: on ? [...hidden, id] : hidden }
  if (bar?.primary && !(on && bar.primary === id)) next.primary = bar.primary
  return next
}

/** One step left (-1) or right (+1) among the shown views; at the end it stays. */
export function moveBar(bar: UiBar | undefined, id: string, dir: -1 | 1, f: BarFlags): UiBar | undefined {
  const { ids } = resolveBar(bar, f)
  const other = ids[ids.indexOf(id as BarId) + dir]
  if (!ids.includes(id as BarId) || !other) return bar
  const order = baseOrder(bar)
  const [a, b] = [order.indexOf(id as BarId), order.indexOf(other)]
  ;[order[a], order[b]] = [order[b], order[a]]
  return { ...bar, order }
}

/** Marks a shown view as the raised centre button. */
export function setPrimary(bar: UiBar | undefined, id: string, f: BarFlags): UiBar | undefined {
  if (!resolveBar(bar, f).ids.includes(id as BarId)) return bar
  return { ...bar, primary: id }
}

/** At most `max` buttons show (the primary always among them); the rest go into the sheet. */
export function barLayout(ids: readonly BarId[], primary: BarId, max: number): { shown: BarId[]; overflow: BarId[] } {
  if (ids.length <= max) return { shown: [...ids], overflow: [] }
  const keep = new Set(ids.slice(0, max))
  if (!keep.has(primary)) { keep.delete(ids[max - 1]); keep.add(primary) }
  return { shown: ids.filter((id) => keep.has(id)), overflow: ids.filter((id) => !keep.has(id)) }
}
