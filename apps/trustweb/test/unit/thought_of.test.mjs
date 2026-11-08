// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { recordThought, thoughtsThisMonth, shareModeOf, thoughtAnswer, activeLineDue, cardText } from '../../src/thought_of.ts'

const p = (o = {}) => ({ id: 'a', name: 'Anna', ring: 'friend', metAt: 0, context: '', lines: [], ...o })
const D = (m, d) => new Date(2026, m - 1, d, 10)

describe('recordThought', () => {
  it('keeps one local day once, however often it fires', () => {
    const a = p()
    expect(recordThought(a, D(11, 7))).toBe(true)
    expect(recordThought(a, D(11, 7))).toBe(false)
    expect(a.thoughtOf).toEqual(['2026-11-07'])
  })
  it('keeps the days sorted and capped at a year', () => {
    const a = p()
    for (let i = 0; i < 400; i++) recordThought(a, new Date(2025, 0, 1 + i))
    expect(a.thoughtOf.length).toBe(366)
    expect(a.thoughtOf).toEqual([...a.thoughtOf].sort())
  })
})

describe('count and share', () => {
  it('counts this calendar month only', () => {
    const a = p({ thoughtOf: ['2026-10-31', '2026-11-01', '2026-11-05'] })
    expect(thoughtsThisMonth(a, D(11, 7))).toBe(2)
    expect(thoughtsThisMonth(p(), D(11, 7))).toBe(0)
  })
  it('defaults to passive', () => {
    expect(shareModeOf(p())).toBe('passive')
    expect(shareModeOf(p({ thoughtShare: 'off' }))).toBe('off')
  })
  it('answers a request with the count only in passive and active mode', () => {
    const a = p({ thoughtOf: ['2026-11-01', '2026-11-05'] })
    expect(thoughtAnswer(a, D(11, 7))).toEqual({ month: '2026-11', count: 2 })
    a.thoughtShare = 'off'
    expect(thoughtAnswer(a, D(11, 7))).toBeNull()
  })
  it('active mode sends one line per day, only when a thought was just recorded', () => {
    const a = p({ thoughtShare: 'active', thoughtOf: ['2026-11-07'] })
    expect(activeLineDue(a, D(11, 7), true)).toBe(true)
    expect(activeLineDue(a, D(11, 7), false)).toBe(false)
    expect(activeLineDue(p({ thoughtOf: ['2026-11-07'] }), D(11, 7), true)).toBe(false)
    expect(activeLineDue({ ...a, thoughtSentDay: '2026-11-07' }, D(11, 7), true)).toBe(false)
  })
})

describe('cardText', () => {
  it('speaks plainly', () => {
    expect(cardText('Anna', 0)).toBe('')
    expect(cardText('Anna', 1)).toBe('You thought of Anna once this month.')
    expect(cardText('Anna', 3)).toBe('You thought of Anna 3 times this month.')
  })
})
