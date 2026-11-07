// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 25 (Jakob 2026-10-29): the membranes page shows the closest five people per membrane, "the combination of the five people you
 * spend most of your time with". Pinned first, then by recency (chat, connect, activity). Everyone else stays one press away.
 * View state only: nothing here travels or changes a record. Pure, no DOM.
 */
import { audienceAdmits } from './model'
import type { AppState, PinnedOrder, Person } from './model'
import { lastContact } from './engagement'
import { tagsOf } from './colour_tags'
import { webSlot } from './rings_layout'

/** Wave 26: records and bundles from before the rename carry `favourite`; it loads as `pinned` (an existing `pinned` wins). */
export function pinnedFrom<T extends object>(p: T): T {
  if (!('favourite' in p)) return p
  const { favourite, ...rest } = p as T & { favourite?: boolean }
  return (favourite === true && !('pinned' in rest) ? { ...rest, pinned: true } : rest) as T
}

/** schema_version.ts chain step: true when a person changed. */
export function repairPinned(s: Pick<AppState, 'people'>): boolean {
  const changed = s.people.some((p) => 'favourite' in p)
  if (changed) s.people = s.people.map(pinnedFrom)
  return changed
}

export const LIMIT_DEFAULT = 5
export const LIMIT_MAX = 20

type State = Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats' | 'meetings' | 'events' | 'membraneLimit' | 'inventory' | 'pinnedOrder'>>

/** People per membrane: absent or junk = 5; clamped 1..20. */
export function limitOf(s: Pick<AppState, 'membraneLimit'>): number {
  const n = s.membraneLimit
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(LIMIT_MAX, Math.max(1, Math.floor(n))) : LIMIT_DEFAULT
}

/** The settings field: null = leave as it was (empty or not a number); else a whole number 1..20. */
export function parseLimit(raw: string): number | null {
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? Math.min(LIMIT_MAX, Math.max(1, Math.floor(n))) : null
}

/** The newest sign of life with `p` (ms; 0 = none): chat, connect time, timeline, meeting, event together. */
export function recency(s: Partial<State>, p: Person, now: number): number {
  return lastContact({ people: [], ...s, engagementSince: undefined }, p, now)
}

/** The pin flag lives here only. */
export const isPinned = (p: Pick<Person, 'pinned'>): boolean => p.pinned === true

/** Pin or unpin: a pin carries the time it was set (`pinnedAt`, for the "when pinned" order); unpinning drops both. */
export function togglePin(p: Person, now: number): void {
  if (p.pinned) { delete p.pinned; delete p.pinnedAt } else { p.pinned = true; p.pinnedAt = now }
}

/** The "Pinned order" setting: absent or junk = by pin time. */
export function pinnedModeOf(s: Partial<Pick<AppState, 'pinnedOrder'>>): PinnedOrder {
  return s.pinnedOrder === 'contact' ? 'contact' : 'pinned'
}

/**
 * Pinned first, then the rest; both by the most recent sign of life `at` (ms). Pinned people in mode 'pinned' go by pin time instead, newest pin
 * first (no `pinnedAt` = oldest, then by `at`); mode 'contact' is the wave 26 order (latest contact). Ties keep a stable order by id. Returns a copy.
 */
export function pinnedOrder(people: readonly Person[], mode: PinnedOrder, at: (p: Person) => number): Person[] {
  const pinAt = (p: Person): number => (mode === 'pinned' && isPinned(p) ? p.pinnedAt ?? 0 : 0)
  return [...people].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || pinAt(b) - pinAt(a) || at(b) - at(a) || (a.id < b.id ? -1 : 1))
}

/** Pinned first, then the most recent; `limit` shown, the others in `rest` (same order). */
export function pickFive(people: readonly Person[], s: Partial<State>, limit: number, now: number): { shown: Person[]; rest: Person[] } {
  const sorted = pinnedOrder(people, pinnedModeOf(s), (p) => recency(s, p, now))
  return { shown: sorted.slice(0, limit), rest: sorted.slice(limit) }
}

/** Wave 33: how many people "closest n" keeps by default. */
export const CLOSEST_LIMIT = 150
export const CLOSEST_MAX = 5000

/** Wave 34: n of "closest n" (s.uiRings.closestN): absent or junk = 150; clamped 1..5000. */
export function closestLimit(ui: { closestN?: unknown } | undefined): number {
  const n = ui?.closestN
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(CLOSEST_MAX, Math.max(1, Math.floor(n))) : CLOSEST_LIMIT
}

/** Wave 34: people per ring the rings draw: the membrane limit, or everyone while "most recent of each ring" is unticked (s.uiRings.perRingLimitOff). */
export const effectiveLimit = (ui: { perRingLimitOff?: boolean } | undefined, s: Pick<AppState, 'membraneLimit'>): number => (ui?.perRingLimitOff ? Infinity : limitOf(s))

/** Wave 33: the n people closest to you across all rings (the same order the rings use: pinned, then most recent); n or fewer = everyone, ranked. */
export function closest150(people: readonly Person[], s: Partial<State>, now: number, limit = CLOSEST_LIMIT): Person[] {
  return pickFive(people, s, limit, now).shown
}

/** The whole zone, shown and rest together: pinned first, then the most recent. */
export function wholeZone(people: readonly Person[], s: Partial<State>, now: number): Person[] {
  const { shown, rest } = pickFive(people, s, Infinity, now)
  return [...shown, ...rest]
}

/** Each ring turns this far further than the one inside it, so adjacent rings' labels do not line up. */
const RING_TURN = 18
/** Degrees clockwise from 12 o'clock (plus the ring's turn): the first five at 1:30, 4:30, 6:00, 7:30, 10:30; any beyond spread evenly between. */
const FIVE = [45, 135, 180, 225, 315]
export function slotAngle(i: number, n: number, ringIndex = 0): number {
  const extra = n - FIVE.length
  const base = i < FIVE.length ? FIVE[i] : ((i - FIVE.length + 0.5) * 360) / extra
  return (base + ringIndex * RING_TURN) % 360
}

/** Indexes of the boxes to hide so no two shown ones intersect: an earlier box wins (greedy). */
export function collidingLabels(boxes: readonly { l: number; t: number; r: number; b: number }[]): number[] {
  const kept: typeof boxes[number][] = []
  const hide: number[] = []
  boxes.forEach((x, i) => {
    if (kept.some((k) => x.l < k.r && k.l < x.r && x.t < k.b && k.t < x.b)) hide.push(i)
    else kept.push(x)
  })
  return hide
}

/** Keeps the people holding colour tag `id`; null = no filter. */
export const withTag = <P extends Pick<Person, 'ring' | 'fields'>>(people: readonly P[], id: string | null): P[] =>
  id === null ? [...people] : people.filter((p) => tagsOf(p, [{ id, colour: '#000000' }]).length > 0)

/** How many of my included resources the membrane of `p` admits: what we share with them. */
export function sharedCount(s: Pick<State, 'inventory'>, p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>): number {
  const ring = webSlot(p)
  return (s.inventory ?? []).filter((i) => i.included && audienceAdmits(i.audience, ring)).length
}
