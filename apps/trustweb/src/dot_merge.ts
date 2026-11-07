// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 32: drag one person's dot onto another and hold there, and the Web view offers to merge them. Pure and DOM-free: the hold
 * state machine and the hit test. The offer only asks; the merge itself needs a tap on Merge in the bubble and then the existing
 * "Same person" sheet (same_person.ts).
 */

/** How long the pointer stays inside the other dot before the offer shows. */
export const HOLD_MS = 600

export type HoldState = { phase: 'none' } | { phase: 'pending' | 'offer'; over: string; since: number }

export type HoldEvent =
  | { type: 'move'; over: string | null; at: number }
  | { type: 'leave' }
  | { type: 'elapsed'; at: number }

export const holdStart = (): HoldState => ({ phase: 'none' })

export function holdStep(s: HoldState, e: HoldEvent): HoldState {
  if (e.type === 'leave') return holdStart()
  if (e.type === 'elapsed') return s.phase === 'pending' && e.at - s.since >= HOLD_MS ? { ...s, phase: 'offer' } : s
  if (e.over === null) return holdStart()
  return s.phase !== 'none' && s.over === e.over ? s : { phase: 'pending', over: e.over, since: e.at }
}

export interface DotBox { id: string; left: number; top: number; right: number; bottom: number }

/** The id of the other dot whose box holds the pointer, else null. */
export function hitDot(dots: DotBox[], selfId: string, x: number, y: number): string | null {
  return dots.find((d) => d.id !== selfId && x >= d.left && x <= d.right && y >= d.top && y <= d.bottom)?.id ?? null
}

/** Wave 37: a drag offers a merge unless there is no merge route (solo) or it carries several ticked dots (select tool); one dot in select mode merges as before. */
export const holdEnabled = (o: { canMerge: boolean; groupSize: number }): boolean => o.canMerge && o.groupSize <= 1
