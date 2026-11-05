// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 wabridge-ingest: per-contact signals and the closeness score, on an invented fixture. */
import { Ring } from '../../src/model.ts'
import { signalsFor, closeness, CLOSE_SCORE, MIN_SCORE } from '../../src/interaction_signals.ts'
import { placementFor } from '../../src/onboarding_place.ts'

const H = 3_600_000
const DAY = 24 * H
const NOW = Date.UTC(2026, 10, 4)
const m = (hoursAgo, fromMe) => ({ ts: NOW - hoursAgo * H, fromMe })

describe('signalsFor', () => {
  it('counts messages, finds the last one and the group co-membership', () => {
    const s = signalsFor([m(50, true), m(49, false), m(2, true)], 3)
    expect(s.messages).toBe(3)
    expect(s.lastTs).toBe(NOW - 2 * H)
    expect(s.groups).toBe(3)
  })
  it('initiated-by-me: a message after 6 h of silence starts a conversation', () => {
    // me starts, they reply; 10 h later they start; 10 h later they start again -> 1 of 3
    const s = signalsFor([m(40, true), m(39.9, false), m(30, false), m(20, false)], 0)
    expect(s.initiatedByMe).toBeCloseTo(1 / 3)
  })
  it('median reply latency: how long they take to answer me inside one conversation', () => {
    const s = signalsFor([m(10, true), m(9.5, false), m(9, true), m(8, false), m(7.9, true), m(6, false)], 0)
    // their replies came after 30 min, 60 min, 114 min -> median 60 min
    expect(s.medianReplyMs).toBe(H)
  })
  it('no reply and no messages give undefined, not NaN', () => {
    expect(signalsFor([m(1, true)], 0).medianReplyMs).toBeUndefined()
    const e = signalsFor([], 0)
    expect(e.messages).toBe(0)
    expect(e.lastTs).toBeUndefined()
    expect(e.initiatedByMe).toBeUndefined()
  })
  it('sorts unordered input', () => {
    expect(signalsFor([m(1, true), m(30, false), m(29.5, true)], 0).lastTs).toBe(NOW - H)
  })
})

describe('closeness', () => {
  const chatty = []
  for (let d = 0; d < 60; d++) chatty.push(m(d * 24 + 5, d % 2 === 0), m(d * 24 + 4.9, d % 2 !== 0))
  it('is between 0 and 1 and ranks a daily balanced chat above a single old one', () => {
    const hi = closeness(signalsFor(chatty, 4), NOW)
    const lo = closeness(signalsFor([m(300 * 24, false)], 0), NOW)
    expect(hi).toBeGreaterThan(CLOSE_SCORE)
    expect(lo).toBeLessThan(MIN_SCORE)
    expect(hi).toBeLessThanOrEqual(1)
    expect(lo).toBeGreaterThanOrEqual(0)
  })
  it('recency matters: the same chat a year ago scores lower', () => {
    const old = chatty.map((x) => ({ ...x, ts: x.ts - 300 * DAY }))
    expect(closeness(signalsFor(old, 4), NOW)).toBeLessThan(closeness(signalsFor(chatty, 4), NOW))
  })
  it('groups together add to it', () => {
    expect(closeness(signalsFor(chatty, 5), NOW)).toBeGreaterThan(closeness(signalsFor(chatty, 0), NOW))
  })
  it('empty signals score 0', () => expect(closeness(signalsFor([], 0), NOW)).toBe(0))
})

describe('placementFor with a closeness score', () => {
  const row = (o = {}) => ({ n365: 20, out: 10, in: 10, days: 10, ...o })
  it('without a score nothing changes', () => expect(placementFor(row()).ring).toBe(Ring.Acquaintance))
  it('both ways but a tiny score: not yet sorted', () => expect(placementFor(row({ closeness: 0.05 })).ring).toBe(Ring.Unsorted))
  it('both ways with a middling score: Acquaintances, no suggestion', () => {
    const p = placementFor(row({ closeness: 0.4 }))
    expect(p.ring).toBe(Ring.Acquaintance)
    expect(p.suggested).toBeUndefined()
  })
  it('a high score only suggests Close friends and allies (I9), never places there', () => {
    const p = placementFor(row({ closeness: 0.85 }))
    expect(p.ring).toBe(Ring.Acquaintance)
    expect(p.suggested).toBe(Ring.Close)
  })
  it('a group-only row stays not yet sorted whatever the score', () => expect(placementFor(row({ group: 'G', closeness: 0.9 })).ring).toBe(Ring.Unsorted))
})
