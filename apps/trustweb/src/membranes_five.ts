// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 25 (Jakob 2026-10-29): the membranes page shows the closest five people per membrane, "the combination of the five people you
 * spend most of your time with". Pinned first, then by recency (chat, connect, activity). Everyone else stays one press away.
 * View state only: nothing here travels or changes a record. Pure, no DOM.
 */
import { audienceAdmits } from './model'
import type { AppState, Person } from './model'
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

type State = Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats' | 'meetings' | 'events' | 'membraneLimit' | 'inventory'>>

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

/** Pinned first, then the most recent; `limit` shown, the others in `rest` (same order). Ties keep a stable order by id. */
export function pickFive(people: readonly Person[], s: Partial<State>, limit: number, now: number): { shown: Person[]; rest: Person[] } {
  const at = new Map(people.map((p) => [p.id, recency(s, p, now)]))
  const sorted = [...people].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || at.get(b.id)! - at.get(a.id)! || (a.id < b.id ? -1 : 1))
  return { shown: sorted.slice(0, limit), rest: sorted.slice(limit) }
}

/** Degrees clockwise from 12 o'clock: the first five at 1:30, 4:30, 6:00, 7:30, 10:30; any beyond spread evenly between. */
const FIVE = [45, 135, 180, 225, 315]
export function slotAngle(i: number, n: number): number {
  if (i < FIVE.length) return FIVE[i]
  const extra = n - FIVE.length
  return ((i - FIVE.length + 0.5) * 360) / extra
}

/** Keeps the people holding colour tag `id`; null = no filter. */
export const withTag = <P extends Pick<Person, 'ring' | 'fields'>>(people: readonly P[], id: string | null): P[] =>
  id === null ? [...people] : people.filter((p) => tagsOf(p, [{ id, colour: '#000000' }]).length > 0)

/** How many of my included resources the membrane of `p` admits: what we share with them. */
export function sharedCount(s: Pick<State, 'inventory'>, p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>): number {
  const ring = webSlot(p)
  return (s.inventory ?? []).filter((i) => i.included && audienceAdmits(i.audience, ring)).length
}
