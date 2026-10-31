// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { INFER, freqTerm, recencyTerm, reciprocityTerm, score } from '../../src/zone_infer.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 31)

describe('zone inference: the three terms', () => {
  it('frequency rises with the count and is capped at 1', () => {
    expect(freqTerm(0)).toBe(0)
    expect(freqTerm(200)).toBeCloseTo(1, 6)
    expect(freqTerm(5000)).toBe(1)
  })
  it('recency halves toward e^-1 at 90 days, and is 0 with no contact', () => {
    expect(recencyTerm(NOW, NOW)).toBe(1)
    expect(recencyTerm(NOW - 90 * DAY, NOW)).toBeCloseTo(Math.exp(-1), 6)
    expect(recencyTerm(undefined, NOW)).toBe(0)
  })
  it('reciprocity is the smaller over the larger, and 0 when one side is empty', () => {
    expect(reciprocityTerm(3, 1)).toBeCloseTo(1 / 3, 6)
    expect(reciprocityTerm(500, 0)).toBe(0)
    expect(reciprocityTerm(0, 0)).toBe(0)
  })
  it('the weights are 0.4, 0.4 and 0.2 in one config object', () => {
    expect(INFER.weights).toEqual({ freq: 0.4, recency: 0.4, reciprocity: 0.2 })
  })
})

describe('zone inference: score cases (T5)', () => {
  it('no evidence scores 0', () => {
    expect(score({ n365: 0, out: 0, in: 0 }, NOW).score).toBe(0)
  })
  it('500 out and 0 in, recent: reciprocity is 0, so the score has no reciprocity part', () => {
    const s = score({ n365: 500, out: 500, in: 0, lastTs: NOW }, NOW)
    expect(s.terms.reciprocity).toBe(0)
    expect(s.score).toBeCloseTo(0.8, 6)
  })
  it('200 out and 200 in in the last 7 days scores high, with reciprocity 1', () => {
    const s = score({ n365: 400, out: 200, in: 200, lastTs: NOW - 7 * DAY }, NOW)
    expect(s.terms.reciprocity).toBe(1)
    expect(s.score).toBeGreaterThanOrEqual(INFER.friendAt)
  })
  it('a future timestamp counts as today, never more than fully recent', () => {
    expect(recencyTerm(NOW + DAY, NOW)).toBe(1)
  })
})
