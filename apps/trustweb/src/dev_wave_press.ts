// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Approve wave press as a pure state machine (dev_feature.ts draws it), the retry for a restarting server and the per-row approve loop. */
import { APPROVE_WAVE_LABEL, changesToApprove, unapproved, type PreviewFeature } from './dev_preview_rules'

export type WavePhase = 'idle' | 'approving' | 'touchid' | 'failed'
export interface WavePress { phase: WavePhase; error: string }
export type WaveEvent = { type: 'press' } | { type: 'merging' } | { type: 'handed' } | { type: 'fail'; reason: string }

export const waveIdle: WavePress = { phase: 'idle', error: '' }

/** A press while a run is going changes nothing; every other event moves the phase. */
export function waveStep(s: WavePress, e: WaveEvent): WavePress {
  if (e.type === 'press') return waveBusy(s) ? s : { phase: 'approving', error: '' }
  if (e.type === 'merging') return { phase: 'touchid', error: '' }
  if (e.type === 'handed') return waveIdle
  return { phase: 'failed', error: e.reason }
}

export const waveBusy = (s: WavePress): boolean => s.phase === 'approving' || s.phase === 'touchid'
export const waveLabel = (s: WavePress): string => s.phase === 'approving' ? 'Approving…' : s.phase === 'touchid' ? 'Touch ID…' : APPROVE_WAVE_LABEL
export const unapprovedLine = (n: number): string => `${n} unapproved items open`
/** The Approve wave box's count line, by verdict over the visible loaded rows (not by what this browser pressed); empty when none waits. */
export const unapprovedNote = (features: PreviewFeature[]): string => {
  const open = unapproved(features).length, changes = changesToApprove(features)
  return [open ? unapprovedLine(open) : '', changes ? `${changes} with changes to approve` : ''].filter(Boolean).join(', ')
}

/** Runs `run` until it succeeds; a failure is retried every `every` ms (a server that restarts) and thrown once `ms` have passed. */
export async function retryFor<T>(run: () => Promise<T>, o: { ms?: number; every?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const { ms = 10_000, every = 500, now = Date.now, sleep = (t: number) => new Promise<void>((r) => setTimeout(r, t)) } = o
  const start = now()
  for (;;) {
    try { return await run() } catch (e) {
      if (now() - start + every > ms) throw e
      await sleep(every)
    }
  }
}

/** One post per row, in order; the first refusal stops the loop and names the row. */
export async function approveEach(rows: { key: string; title: string }[], post: (key: string) => Promise<boolean>): Promise<void> {
  for (const f of rows) if (!(await post(f.key))) throw new Error(`Could not approve ${f.title}`)
}
