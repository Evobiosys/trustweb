// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31: the configurable bottom bar. Stored as AppState.uiBar {order, hidden, primary}; absent = the default
 * (Web, Chat, Record, Events, Resources; Ask your web and the Feed are opt-in from the ⋮ sheet). Record cannot be hidden and is the primary (raised)
 * button unless another shown view is chosen. A view this build does not know, or whose feature is off, is skipped.
 * On a phone at most PHONE_MAX buttons show; the rest live in the ⋮ sheet. Pure, no DOM.
 */
export type BarId = 'ask' | 'inventory' | 'web' | 'feed' | 'record' | 'chat' | 'events' | 'network' | 'people' | 'map' | `view:${string}` | `mod:${string}`

export interface UiBar {
  order?: string[]
  hidden?: string[]
  primary?: string
  /** BAR_ORDER_VERSION once the wave-33 default order has been applied (or the user set the order since). */
  orderVersion?: number
  /** Wave 33: the preset last chosen (PROFILES id), or 'custom' once the bar was edited by hand. Optional, no schema bump. */
  profile?: string
  /** Wave 40: the views (at most HALO_MAX) that wear a halo in the row, the pressable highlight. */
  halo?: string[]
}

export const BAR_ORDER_VERSION = 2

export interface BarFlags {
  events: boolean
  feed: boolean
  inventory: boolean
  people: boolean
  map: boolean
  /** Wave 35: advanced mode on; only then the `view:<id>` entries show and are offered. */
  advanced?: boolean
  /** Wave 39: the view ids of the extension modules that are on (ext/tw_registry.ts views()); each joins the row as `mod:<id>` at the end unless taken out. */
  mods?: readonly string[]
}

export const DEFAULT_ORDER: readonly BarId[] = ['web', 'chat', 'record', 'events', 'inventory']
export const PHONE_MAX = 6

/** The sheet's checklist, in its order (Record is always on and not listed). */
const CHOICES: readonly BarId[] = ['web', 'feed', 'chat', 'events', 'inventory', 'ask', 'network', 'people', 'map']

/** Wave 35: the view a `view:<id>` bar entry opens (a view_menu ViewKey); null for every other entry. */
export const viewOfBar = (id: string): string | null => (id.startsWith('view:') && id.length > 5 ? id.slice(5) : null)

/** Wave 39: the module view a `mod:<id>` bar entry opens; null for every other entry. */
export const modOfBar = (id: string): string | null => (id.startsWith('mod:') && id.length > 4 ? id.slice(4) : null)

/** The `view:<id>` entries kept in the saved order (they stay stored in simple mode). */
const viewEntries = (bar: UiBar | undefined): BarId[] => [...new Set(Array.isArray(bar?.order) ? bar.order : [])].filter((id): id is BarId => typeof id === 'string' && viewOfBar(id) !== null)

function offered(f: BarFlags, bar?: UiBar): BarId[] {
  const off: Partial<Record<BarId, boolean>> = { events: !f.events, feed: !f.feed, inventory: !f.inventory, people: !f.people, map: !f.map }
  return [...(['record', ...CHOICES] as BarId[]).filter((id) => !off[id]), ...(f.advanced ? viewEntries(bar) : []), ...(f.mods ?? []).map((m): BarId => `mod:${m}`)]
}

/** The saved order (or the default) with Record in it, unknown ids and duplicates dropped; Record lands mid-row when missing. */
function baseOrder(bar: UiBar | undefined): BarId[] {
  const known = new Set<string>(['record', ...CHOICES])
  const saved = Array.isArray(bar?.order) ? bar.order : DEFAULT_ORDER
  const order = [...new Set(saved)].filter((id): id is BarId => typeof id === 'string' && (known.has(id) || viewOfBar(id) !== null || modOfBar(id) !== null))
  if (!order.includes('record')) order.splice(Math.ceil(order.length / 2), 0, 'record')
  return order
}

/** Wave 35: the raised button when the user never chose: none for an even number of buttons, else the preset's (Record by default). */
export function defaultPrimary(ids: readonly BarId[], preset: BarId = 'record'): BarId | null {
  return ids.length % 2 === 0 ? null : ids.includes(preset) ? preset : 'record'
}

/** Wave 40: an even number of buttons has no single centre, so the two inner ones are raised together. */
export function defaultPair(ids: readonly BarId[]): BarId[] {
  const n = ids.length
  return n >= 2 && n % 2 === 0 ? [ids[n / 2 - 1], ids[n / 2]] : []
}

/** primary is null when no button is raised (stored as 'none'); pair = the two inner buttons raised by default for an even count (never when the user chose, or chose none). */
/** The saved order plus the module buttons not saved yet, at the end (where resolveBar shows them). Review wave 40: moves and adds work on this, so a module's button is never an unknown neighbour. */
function fullOrder(bar: UiBar | undefined, f: BarFlags): BarId[] {
  const base = baseOrder(bar)
  return [...base, ...(f.mods ?? []).map((m): BarId => `mod:${m}`).filter((id) => !base.includes(id))]
}

export function resolveBar(bar: UiBar | undefined, f: BarFlags): { ids: BarId[]; primary: BarId | null; pair: BarId[] } {
  const ok = new Set<string>(offered(f, bar))
  const hidden = new Set<unknown>(Array.isArray(bar?.hidden) ? bar.hidden : [])
  const ids = fullOrder(bar, f).filter((id) => ok.has(id) && (id === 'record' || !hidden.has(id)))
  // Wave 39: a module's button does not change which button is raised by default.
  const own = ids.filter((id) => modOfBar(id) === null)
  const primary = bar?.primary === 'none' ? null : ids.includes(bar?.primary as BarId) ? (bar?.primary as BarId) : defaultPrimary(own)
  return { ids, primary, pair: primary === null && bar?.primary !== 'none' ? defaultPair(own) : [] }
}

/** Every view the sheet offers, with whether it sits in the bar now. */
export function barChoices(bar: UiBar | undefined, f: BarFlags): { id: BarId; on: boolean }[] {
  const { ids } = resolveBar(bar, f)
  return offered(f, bar).filter((id) => id !== 'record').map((id) => ({ id, on: ids.includes(id) }))
}

/** Shows the view if it is hidden or new, hides it if shown. Record and unknown ids change nothing. Hiding the primary hands it back to Record. */
export function toggleBar(bar: UiBar | undefined, id: string, f: BarFlags): UiBar | undefined {
  if (!offered(f, bar).includes(id as BarId) || id === 'record') return bar
  const on = resolveBar(bar, f).ids.includes(id as BarId)
  const order = baseOrder(bar)
  const hidden = (bar?.hidden ?? []).filter((h) => h !== id)
  if (!on && !order.includes(id as BarId)) order.push(id as BarId)
  const next: UiBar = { order, hidden: on ? [...hidden, id] : hidden, orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
  if (bar?.primary && !(on && bar.primary === id)) next.primary = bar.primary
  return next
}

/** Wave 35: puts the `view:<id>` entry of a view into the row (at the end) or takes it out. */
export function showViewInBar(bar: UiBar | undefined, view: string, on: boolean): UiBar {
  const id = `view:${view}`
  const order = baseOrder(bar).filter((x) => x !== id)
  if (on) order.push(id as BarId)
  return { ...bar, order, hidden: (bar?.hidden ?? []).filter((h) => h !== id), orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
}

/** Shows the view (new, hidden or already shown) left or right of a shown view `ref`; the place is saved in `order`. Bad input changes nothing. */
export function addBar(bar: UiBar | undefined, id: string, ref: string, side: 'left' | 'right', f: BarFlags): UiBar | undefined {
  if (!offered(f, bar).includes(id as BarId) || id === 'record' || id === ref || !resolveBar(bar, f).ids.includes(ref as BarId)) return bar
  const order = fullOrder(bar, f).filter((x) => x !== id)
  order.splice(order.indexOf(ref as BarId) + (side === 'right' ? 1 : 0), 0, id as BarId)
  return { ...bar, order, hidden: (bar?.hidden ?? []).filter((h) => h !== id), orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
}

/** One step left (-1) or right (+1) among the shown views; at the end it stays. */
export function moveBar(bar: UiBar | undefined, id: string, dir: -1 | 1, f: BarFlags): UiBar | undefined {
  const { ids } = resolveBar(bar, f)
  const other = ids[ids.indexOf(id as BarId) + dir]
  if (!ids.includes(id as BarId) || !other) return bar
  const order = fullOrder(bar, f)
  const [a, b] = [order.indexOf(id as BarId), order.indexOf(other)]
  ;[order[a], order[b]] = [order[b], order[a]]
  return { ...bar, order, orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
}

/** Wave 40: whether the view can take one step left (-1) or right (+1) in the row; false at either end and for views that are not in the row. */
export function canMoveBar(bar: UiBar | undefined, id: string, dir: -1 | 1, f: BarFlags): boolean {
  const { ids } = resolveBar(bar, f)
  const at = ids.indexOf(id as BarId)
  return at >= 0 && at + dir >= 0 && at + dir < ids.length
}

/** Wave 40: every view in the order the arrange list shows it: the row left to right, then the ⋮ overflow top to bottom, then the views that are off. */
export function arrangeRows(bar: UiBar | undefined, f: BarFlags, max: number): { id: BarId; slot: 'row' | 'more' | 'off' }[] {
  const { ids, primary } = resolveBar(bar, f)
  const { shown, overflow } = barLayout(ids, primary, max)
  const off = offered(f, bar).filter((id) => id !== 'record' && !ids.includes(id))
  return [...shown.map((id) => ({ id, slot: 'row' as const })), ...overflow.map((id) => ({ id, slot: 'more' as const })), ...off.map((id) => ({ id, slot: 'off' as const }))]
}

/** Wave 40: a view from the ⋮ list moves INTO the row, at the last slot the row keeps for it (the one that sat there goes to the top of the overflow); a hidden view is shown again. Record and unknown ids change nothing. */
export function promoteBar(bar: UiBar | undefined, id: string, f: BarFlags, max: number): UiBar | undefined {
  if (!offered(f, bar).includes(id as BarId) || id === 'record') return bar
  const { ids, primary } = resolveBar(bar, f)
  const rest = ids.filter((x) => x !== id)
  let order: BarId[] = [...rest, id as BarId]
  for (let k = Math.min(max - 1, rest.length); k >= 0; k--) {
    order = [...rest.slice(0, k), id as BarId, ...rest.slice(k)]
    if (barLayout(order, primary, max).shown.includes(id as BarId)) break
  }
  const kept = baseOrder(bar).filter((x) => !order.includes(x))
  return { ...bar, order: [...order, ...kept], hidden: (bar?.hidden ?? []).filter((h) => h !== id), orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
}

export const HALO_MAX = 2

/** Wave 40: the views wearing a halo now: stored ones that are still in the row, the newest HALO_MAX. */
export const haloOf = (bar: UiBar | undefined, ids: readonly BarId[]): BarId[] =>
  (Array.isArray(bar?.halo) ? bar.halo : []).filter((id): id is BarId => ids.includes(id as BarId)).slice(-HALO_MAX)

/** Wave 40: a press puts the halo on a view in the row (the third drops the oldest) or takes it off. Views not in the row change nothing. */
export function toggleHalo(bar: UiBar | undefined, id: string, f: BarFlags): UiBar | undefined {
  const { ids } = resolveBar(bar, f)
  if (!ids.includes(id as BarId)) return bar
  const now = haloOf(bar, ids)
  const next = now.includes(id as BarId) ? now.filter((x) => x !== id) : [...now, id as BarId].slice(-HALO_MAX)
  return { ...bar, halo: next }
}

/** Marks a shown view as the raised centre button; 'none' raises nothing. */
export function setPrimary(bar: UiBar | undefined, id: string, f: BarFlags): UiBar | undefined {
  if (id !== 'none' && !resolveBar(bar, f).ids.includes(id as BarId)) return bar
  return { ...bar, primary: id, profile: 'custom' }
}

/** At most `max` buttons show (the primary always among them); the rest go into the sheet. */
export function barLayout(ids: readonly BarId[], primary: BarId | null, max: number): { shown: BarId[]; overflow: BarId[] } {
  if (ids.length <= max) return { shown: [...ids], overflow: [] }
  const keep = new Set(ids.slice(0, max))
  if (primary && !keep.has(primary)) { keep.delete(ids[max - 1]); keep.add(primary) }
  return { shown: ids.filter((id) => keep.has(id)), overflow: ids.filter((id) => !keep.has(id)) }
}

/** Wave 33: once per record (marker uiBar.orderVersion, no schema bump), a saved order becomes the new default; flags stay, views it added itself (not Ask, which left the default) stay at the end. */
export function resetBarOrder(s: { uiBar?: UiBar }): boolean {
  if (!s.uiBar || (s.uiBar.orderVersion ?? 0) >= BAR_ORDER_VERSION) return false
  s.uiBar.orderVersion = BAR_ORDER_VERSION
  const old = s.uiBar.order
  if (!Array.isArray(old)) return true
  const extras = [...new Set(old)].filter((id) => typeof id === 'string' && id !== 'ask' && !DEFAULT_ORDER.includes(id as BarId))
  s.uiBar.order = [...DEFAULT_ORDER, ...extras]
  return true
}

/**
 * Wave 33: the default profiles. Five slots, the centre one is the raised primary button. Note taker is the old default;
 * Connector differs from it (Record second, Chat in the centre) so that the two names stay distinct. Names are suggestions.
 */
export const PROFILES: readonly { id: string; order: readonly BarId[]; primary: BarId }[] = [
  { id: 'connector', order: ['web', 'record', 'chat', 'events', 'inventory'], primary: 'chat' },
  { id: 'up_to_date', order: ['web', 'chat', 'feed', 'events', 'inventory'], primary: 'feed' },
  { id: 'note_taker', order: DEFAULT_ORDER, primary: 'record' },
  // Retired in wave 34 (archived here; a stored 'communicator' counts as 'custom'):
  // { id: 'communicator', order: ['web', 'feed', 'chat', 'events', 'inventory'], primary: 'chat' },
]

/** Sets order, primary, marker and profile from a preset; hidden is cleared. Unknown id changes nothing. */
export function applyProfile(bar: UiBar | undefined, id: string): UiBar | undefined {
  const p = PROFILES.find((x) => x.id === id)
  if (!p) return bar
  return { ...bar, order: [...p.order], hidden: [], primary: p.primary, orderVersion: BAR_ORDER_VERSION, profile: p.id }
}

/** Wave 34: starts a custom bar from the bar as it is now (the shown ids, in order, and the current primary). */
export function customFrom(bar: UiBar | undefined, ids: readonly BarId[], primary: BarId | null): UiBar {
  return { ...bar, order: [...ids], hidden: [], primary: primary ?? 'none', orderVersion: BAR_ORDER_VERSION, profile: 'custom' }
}

/** The stored profile; without one, the preset the bar happens to match, else 'custom'. */
export function activeProfile(bar: UiBar | undefined, f: BarFlags): string {
  if (bar?.profile && (bar.profile === 'custom' || PROFILES.some((p) => p.id === bar.profile))) return bar.profile
  const { ids, primary } = resolveBar(bar, f)
  const core = ids.filter((id) => modOfBar(id) === null) // wave 39: a module's own button does not make the row custom
  return PROFILES.find((p) => p.primary === primary && p.order.join() === core.join())?.id ?? 'custom'
}

/** Wave 35: the views the ⋮ button lists: offered, not in the bar. People and Map only once the user took them out of it. */
export function overflowChoices(ids: readonly BarId[], hidden: readonly string[], f: BarFlags): BarId[] {
  const mods = (f.mods ?? []).map((m): BarId => `mod:${m}`) // wave 39: a module view taken out of the row
  return [...CHOICES, ...mods].filter((id) => offered(f).includes(id) && !ids.includes(id) && (id !== 'people' && id !== 'map' || hidden.includes(id)))
}
