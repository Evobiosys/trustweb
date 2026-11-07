// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 rings-controls: drop on any bottom-row control, hidden people before the top five, dots keep their size. */
import { hitControls, visibleIn, inExpanse, hideInExpanse } from '../../src/expanse.ts'
import { dotSize, ringsGeometry } from '../../src/rings_layout.ts'
import { pickFive } from '../../src/membranes_five.ts'

const box = (id, left) => ({ id, left, top: 100, right: left + 30, bottom: 130 })

describe('hitControls', () => {
  const row = [box('a', 10), box('b', 50), box('c', 90)]
  it('picks the control under the pointer', () => {
    expect(hitControls(row, 60, 110)?.id).toBe('b')
    expect(hitControls(row, 15, 125)?.id).toBe('a')
    expect(hitControls(row, 119, 100)?.id).toBe('c')
  })
  it('null between controls and outside the row', () => {
    expect(hitControls(row, 45, 110)).toBeNull()
    expect(hitControls(row, 60, 50)).toBeNull()
    expect(hitControls([], 1, 1)).toBeNull()
  })
})

describe('hidden before the top five', () => {
  const people = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, context: '', ring: 'friend', metAt: i, lines: [] }))
  it('a hidden id never reaches pickFive, so it never takes a top-five slot', () => {
    const s = {}
    hideInExpanse(s, 'p0'); hideInExpanse(s, 'p1')
    expect(visibleIn(s, people).map((p) => p.id)).not.toContain('p0')
    const f = pickFive(visibleIn(s, people), s, 5, Date.now())
    const ids = [...f.shown, ...f.rest].map((p) => p.id)
    expect(ids).toHaveLength(6)
    expect(ids.some((id) => inExpanse(s, id))).toBe(false)
    expect(f.shown).toHaveLength(5)
  })
})

describe('dots keep their size (pre-#80)', () => {
  it('dotSize is min(42, dot) at scale 1 for a crowded ring and with an Unsorted ring', () => {
    for (const counts of [{ acquaintance: 120 }, { friend: 5, unsorted: 40 }, { closest: 3, intending: 2 }]) {
      const g = ringsGeometry(counts, {}, 1)
      for (const r of g.rings) expect(dotSize(g, r)).toBe(Math.min(42, g.dot[r]))
    }
  })
  it('the view scale never shrinks a dot: a full ring stays 42', () => {
    const g = ringsGeometry({ friend: 2 }, {}, 0.85)
    expect(dotSize(g, 'friend')).toBe(42)
  })
})
