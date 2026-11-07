// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36: the 3-2-1 that merges two dots (or applies the suggested keep) by itself when nobody objects. Pure and DOM-free; the
 * timers live in web_view.ts and sync_view.ts.
 */

export const COUNTDOWN_S = 3

export interface Tick { secondsLeft: number; fire: boolean }

export interface Countdown {
  start(nowMs: number): void
  /** secondsLeft counts 3, 2, 1, 0; fire is true once, at the first tick on or after 0. Idle: {0, false}. */
  tick(nowMs: number): Tick
  cancel(): void
}

export function createCountdown(seconds = COUNTDOWN_S): Countdown {
  let from: number | null = null
  return {
    start: (nowMs) => { from = nowMs },
    tick: (nowMs) => {
      if (from === null) return { secondsLeft: 0, fire: false }
      const left = Math.max(0, Math.ceil(seconds - (nowMs - from) / 1000))
      if (left > 0) return { secondsLeft: left, fire: false }
      from = null
      return { secondsLeft: 0, fire: true }
    },
    cancel: () => { from = null },
  }
}

interface Suggestable { lines: readonly unknown[]; metAt: number }

/** The one to keep: more lines wins, a tie goes to the older record (earlier metAt), a tie after that to the first argument. */
export function suggestKeep<T extends Suggestable>(a: T, b: T): T {
  if (a.lines.length !== b.lines.length) return a.lines.length > b.lines.length ? a : b
  return b.metAt < a.metAt ? b : a
}
