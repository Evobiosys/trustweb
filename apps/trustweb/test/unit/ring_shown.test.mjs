// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 ring-rule: a manual move changes only the moved dot; the recent-N rule re-applies only when the user asks, with a diff to animate. */
import { shownAfterMove, stickyCut, shownKey } from '../../src/ring_shown.ts'

// ranked best-first; ring AFTER the move. a1..a4 in ring A, b1..b4 in ring B; limit 2.
const ranked = [
  { id: 'a1', ring: 'A' }, { id: 'a2', ring: 'A' }, { id: 'a3', ring: 'A' }, { id: 'a4', ring: 'A' },
  { id: 'b1', ring: 'B' }, { id: 'b2', ring: 'B' }, { id: 'b3', ring: 'B' }, { id: 'b4', ring: 'B' },
]
const prev = new Set(['a1', 'a2', 'b1', 'b2'])

describe('shownAfterMove, autoAdjust off', () => {
  it('a dot moved into B (b-rank low) is added; nothing else appears or disappears', () => {
    const moved = [{ id: 'a1', ring: 'B' }, ...ranked.filter((p) => p.id !== 'a1')]
    const r = shownAfterMove(prev, moved, 'a1', 2, false)
    expect([...r.shown].sort()).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(r.appear).toEqual([])
    expect(r.disappear).toEqual([])
  })
  it('a moved dot that was hidden joins; the rest stays', () => {
    const r = shownAfterMove(prev, ranked, 'a4', 2, false)
    expect([...r.shown].sort()).toEqual(['a1', 'a2', 'a4', 'b1', 'b2'])
  })
  it('does not mutate prev', () => {
    shownAfterMove(prev, ranked, 'a4', 2, false)
    expect(prev.size).toBe(4)
  })
})

describe('shownAfterMove, autoAdjust on', () => {
  it('the recent-N rule applies and the diff names who appears and who goes', () => {
    const moved = [{ id: 'a1', ring: 'B' }, ...ranked.filter((p) => p.id !== 'a1')]
    const r = shownAfterMove(prev, moved, 'a1', 2, true)
    // ring A now: a2, a3 (limit 2); ring B: a1 (first, moved), b1
    expect([...r.shown].sort()).toEqual(['a1', 'a2', 'a3', 'b1'])
    expect(r.appear).toEqual(['a3'])
    expect(r.disappear).toEqual(['b2'])
  })
  it('someone ranked out disappears', () => {
    const r = shownAfterMove(new Set(['a1', 'a2', 'a4', 'b1', 'b2']), ranked, 'a1', 2, true)
    expect(r.disappear).toEqual(['a4'])
    expect(r.appear).toEqual([])
  })
})

describe('stickyCut', () => {
  it('splits a ring by the saved ids, order kept', () => {
    const ps = ranked.filter((p) => p.ring === 'A')
    const r = stickyCut(ps, new Set(['a2', 'a4']))
    expect(r.shown.map((p) => p.id)).toEqual(['a2', 'a4'])
    expect(r.rest.map((p) => p.id)).toEqual(['a1', 'a3'])
  })
  it('review: someone added after the saved move still shows (the saved set never hides a newcomer)', () => {
    const ps = [{ id: 'a1', metAt: 100 }, { id: 'a2', metAt: 100 }, { id: 'new', metAt: 900 }]
    const r = stickyCut(ps, new Set(['a1']), 500)
    expect(r.shown.map((p) => p.id)).toEqual(['a1', 'new'])
    expect(r.rest.map((p) => p.id)).toEqual(['a2'])
  })
  it('review: without a saved time nobody counts as new', () => {
    const r = stickyCut([{ id: 'a1', metAt: 900 }, { id: 'a2', metAt: 900 }], new Set(['a1']))
    expect(r.shown.map((p) => p.id)).toEqual(['a1'])
  })
})

describe('shownKey', () => {
  it('changes with m, rank mode and the per-ring switch', () => {
    const k = shownKey(5, undefined, undefined)
    expect(shownKey(6, undefined, undefined)).not.toBe(k)
    expect(shownKey(5, 'frequent', undefined)).not.toBe(k)
    expect(shownKey(5, undefined, true)).not.toBe(k)
  })
})
