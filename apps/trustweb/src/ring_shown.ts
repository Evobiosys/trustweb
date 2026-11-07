// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: which dots a ring shows after a manual move. Pure, no DOM. Off (default): only the moved dot changes. On: the recent-N rule re-applies and the diff says who fades in or out. */

export interface RankedDot { id: string; ring: string }
export interface ShownChange { shown: Set<string>; appear: string[]; disappear: string[] }

/** `ranked` = everyone, best first, rings as they are after the move. */
export function shownAfterMove(prevShown: ReadonlySet<string>, ranked: readonly RankedDot[], movedId: string, limit: number, autoAdjust: boolean): ShownChange {
  if (!autoAdjust) return { shown: new Set([...prevShown, movedId]), appear: [], disappear: [] }
  const seen = new Map<string, number>()
  const shown = new Set<string>()
  for (const p of ranked) {
    const n = seen.get(p.ring) ?? 0
    seen.set(p.ring, n + 1)
    if (n < limit || p.id === movedId) shown.add(p.id)
  }
  return { shown, appear: [...shown].filter((id) => !prevShown.has(id)), disappear: [...prevShown].filter((id) => !shown.has(id)) }
}

/** One ring's people split by the saved ids; order kept. Someone met after `savedAt` (added since the move) is not held back by the saved set. */
export function stickyCut<T extends { id: string; metAt?: number }>(ps: readonly T[], ids: ReadonlySet<string>, savedAt = Infinity): { shown: T[]; rest: T[] } {
  const keep = (p: T): boolean => ids.has(p.id) || (p.metAt ?? 0) > savedAt
  return { shown: ps.filter(keep), rest: ps.filter((p) => !keep(p)) }
}

/** The settings the saved set belongs to: a new m, rank mode or per-ring switch drops it. */
export const shownKey = (m: number, rankBy: string | undefined, perRingLimitOff: boolean | undefined, filled: readonly string[] = []): string => `${m}|${rankBy ?? ''}|${perRingLimitOff ? 1 : 0}|${filled.join(',')}`
