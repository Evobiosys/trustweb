// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Trust-zone inference from interaction (wave 27, F5): how often, how recently and how evenly two people talk.
 * Pure: no DOM, no network, no storage. Counts come from the crm evidence rows (apps/crm/src/import/evidence.ts)
 * and only ever PROPOSE a zone; the owner decides (I9). The config object below is the one place to tune it.
 */

const DAY_MS = 86_400_000

export const INFER = {
  weights: { freq: 0.4, recency: 0.4, reciprocity: 0.2 },
  /** Frequency saturates at this many contacts in the last year. */
  freqCap: 200,
  /** Recency decays as exp(-days / recencyDays). */
  recencyDays: 90,
  /** Score thresholds for the proposed tier (F6). */
  friendAt: 0.6,
  communityAt: 0.35,
} as const

/** The counts one person has with me. `in`: they wrote to me; `out`: I wrote to them. */
export interface Interaction {
  n365: number
  out: number
  in: number
  /** Latest contact at or before now, any age. Absent: no evidence. */
  lastTs?: number
}

export interface Terms {
  freq: number
  recency: number
  reciprocity: number
}

export interface Scored {
  score: number
  terms: Terms
}

export function freqTerm(n365: number): number {
  return Math.min(1, Math.log1p(n365) / Math.log1p(INFER.freqCap))
}

export function recencyTerm(lastTs: number | undefined, now: number): number {
  if (lastTs === undefined) return 0
  const days = Math.max(0, (now - lastTs) / DAY_MS)
  return Math.exp(-days / INFER.recencyDays)
}

/** The smaller side over the larger; 0 when either side is empty (one-way contact is not reciprocity). */
export function reciprocityTerm(out: number, inn: number): number {
  return out > 0 && inn > 0 ? Math.min(out, inn) / Math.max(out, inn) : 0
}

export function score(i: Interaction, now: number): Scored {
  const terms: Terms = {
    freq: freqTerm(i.n365),
    recency: recencyTerm(i.lastTs, now),
    reciprocity: reciprocityTerm(i.out, i.in),
  }
  const w = INFER.weights
  return { score: w.freq * terms.freq + w.recency * terms.recency + w.reciprocity * terms.reciprocity, terms }
}
