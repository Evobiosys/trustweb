/**
 * Wave 6h: the one rule every small list kept in the record follows (late_answers.ts, held_asks.ts, unmatched_asks.ts): read through a
 * guard (well-formed entries only, a record from another build may hold anything), none older than its keep time, newest first, bounded.
 * Never throws. Pure and DOM-free.
 */

/** An entry kept by time. */
export interface Kept {
  at: number
}

export interface KeepRule<T extends Kept> {
  /** Is this unknown value a well-formed entry? */
  is(v: unknown): v is T
  /** Kept at most this long after `at`. */
  keepMs: number
  /** Kept at most this many, newest first. */
  max: number
}

/** The kept list, cleaned. `list` may be anything (absent, another build's shape). */
export function keptList<T extends Kept>(list: unknown, rule: KeepRule<T>, now: number): T[] {
  if (!Array.isArray(list)) return []
  return list.filter(rule.is).filter((x) => now - x.at <= rule.keepMs).sort((a, b) => b.at - a.at).slice(0, rule.max)
}

/** A plain object (not null, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Keeps at most `max` characters (code points, so a surrogate pair is never cut). */
export function clipText(s: string, max: number): string {
  return [...s].slice(0, max).join('')
}
