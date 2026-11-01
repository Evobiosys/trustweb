// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * State of one "From other services" pass (wave 28): reading the picked files and planning. Pure, so the view can redraw on every change
 * and a pass that hangs turns into a failure with a retry instead of a state that stays until the page is refreshed.
 */
export type RunPhase = 'idle' | 'reading' | 'ready' | 'failed'
export interface Run { phase: RunPhase; since: number; error?: string }

export const RUN_LIMIT_MS = 30_000
export const IDLE_RUN: Run = { phase: 'idle', since: 0 }

export const startRun = (now: number): Run => ({ phase: 'reading', since: now })
export const finishRun = (r: Run): Run => (r.phase === 'reading' ? { phase: 'ready', since: r.since } : r)
export const failRun = (r: Run, error: string): Run => (r.phase === 'reading' ? { phase: 'failed', since: r.since, error } : r)
export const tickRun = (r: Run, now: number): Run => (r.phase === 'reading' && now - r.since >= RUN_LIMIT_MS ? failRun(r, 'timeout') : r)
