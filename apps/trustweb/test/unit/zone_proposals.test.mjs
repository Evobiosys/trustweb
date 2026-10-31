// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { Ring } from '../../src/model.ts'
import { propose, writeFor, bulkAcceptable, PROPOSAL_LABEL } from '../../src/zone_proposals.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 31)
const cand = (personKey, over = {}) => ({ personKey, n365: 0, out: 0, in: 0, ids: [], ...over })
const one = (over) => propose([cand('p', over)], NOW)[0]

describe('zone proposals: tiers (F6, T5)', () => {
  it('no evidence proposes Acquaintance with score 0 and no evidence ids', () => {
    const p = one({})
    expect(p.ring).toBe(Ring.Acquaintance)
    expect(p.score).toBe(0)
    expect(p.evidenceIds).toEqual([])
  })
  it('200 out and 200 in in the last 7 days proposes Friend', () => {
    const p = one({ n365: 400, out: 200, in: 200, lastTs: NOW - 7 * DAY, ids: ['a'] })
    expect(p.tier).toBe('friend')
    expect(p.ring).toBe(Ring.Friend)
  })
  it('500 out and 0 in is not Friend (one-way contact, reciprocity 0)', () => {
    const p = one({ n365: 500, out: 500, in: 0, lastTs: NOW, ids: ['a'] })
    expect(p.tier).not.toBe('friend')
    expect(p.flags).toContain('one-way')
  })
  it('a middling score proposes community', () => {
    const p = one({ n365: 10, out: 9, in: 1, lastTs: NOW - 30 * DAY, ids: ['a'] })
    expect(p.tier).toBe('community')
  })
})

describe('zone proposals: properties', () => {
  it('T6: no proposal is ever Close or Closest, over many generated cases', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const list = []
    for (let i = 0; i < 2000; i++) {
      const out = Math.floor(rnd() * 800)
      const inn = Math.floor(rnd() * 800)
      list.push(cand(`k${i}`, { n365: out + inn, out, in: inn, lastTs: NOW - Math.floor(rnd() * 400) * DAY, ids: ['e'] }))
    }
    for (const p of propose(list, NOW)) {
      expect(p.ring).not.toBe(Ring.Close)
      expect(p.ring).not.toBe(Ring.Closest)
    }
  })
  it('T7: every proposal with a score above 0 has evidence ids and the three terms', () => {
    const list = [
      cand('a', { n365: 30, out: 10, in: 20, lastTs: NOW - DAY, ids: ['1', '2'] }),
      cand('b', { n365: 0 }),
    ]
    for (const p of propose(list, NOW)) {
      if (p.score > 0) {
        expect(p.evidenceIds.length).toBeGreaterThan(0)
        expect(Object.keys(p.terms).sort()).toEqual(['freq', 'recency', 'reciprocity'])
      }
    }
  })
  it('I6: every proposal carries the label "inferred, not verified"', () => {
    expect(one({}).label).toBe(PROPOSAL_LABEL)
    expect(PROPOSAL_LABEL).toBe('inferred, not verified')
  })
  it('T10: scoring makes no network call', () => {
    const before = globalThis.fetch
    let calls = 0
    globalThis.fetch = () => { calls++; return Promise.reject(new Error('no network')) }
    try {
      propose([cand('a', { n365: 3, out: 1, in: 2, lastTs: NOW, ids: ['x'] })], NOW)
    } finally {
      globalThis.fetch = before
    }
    expect(calls).toBe(0)
  })
  it('a possible duplicate is flagged, and only zero-flag rows are bulk-acceptable', () => {
    const clean = propose([cand('a', { n365: 10, out: 5, in: 5, lastTs: NOW, ids: ['x'] })], NOW)[0]
    const dupe = propose([cand('b', { n365: 10, out: 5, in: 5, lastTs: NOW, ids: ['x'], dupe: true })], NOW)[0]
    expect(dupe.flags).toContain('possible-duplicate')
    expect(bulkAcceptable(clean)).toBe(true)
    expect(bulkAcceptable(dupe)).toBe(false)
  })
})

describe('zone proposals: curation writes (T9, I9)', () => {
  const p = one({ n365: 400, out: 200, in: 200, lastTs: NOW - DAY, ids: ['a'] })
  it('Accept writes the proposed ring and an in_zone tuple of one year', () => {
    const w = writeFor(p, { do: 'accept' }, NOW)
    expect(w.ring).toBe(Ring.Friend)
    expect(w.inZone).toEqual({ ring: Ring.Friend, since: NOW, until: NOW + 365 * DAY })
  })
  it('Change writes the chosen ring, not the proposed one', () => {
    const w = writeFor(p, { do: 'change', ring: Ring.Acquaintance }, NOW)
    expect(w.ring).toBe(Ring.Acquaintance)
    expect(w.inZone.ring).toBe(Ring.Acquaintance)
  })
  it('Leave writes nothing', () => {
    expect(writeFor(p, { do: 'leave' }, NOW)).toBeNull()
  })
})
