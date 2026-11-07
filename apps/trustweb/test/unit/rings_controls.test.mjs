// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 rings-controls: drop on any bottom-row control, hidden people before the top five, dots keep their size. */
import { hitControls, visibleIn, inExpanse, hideInExpanse } from '../../src/expanse.ts'
import { chainPoints, HANDLE } from '../../src/ring_handles.ts'
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

describe('chainPoints: one bottom-anchored column', () => {
  it('same x, first at the bottom edge, each next one pitch higher toward the centre', () => {
    const pts = chainPoints(4, 176, 352)
    expect(new Set(pts.map((p) => p.left))).toEqual(new Set([176]))
    expect(pts[0].top).toBe(352 - HANDLE / 2 - 2)
    pts.slice(1).forEach((p, i) => expect(pts[i].top - p.top).toBe(HANDLE + 4))
  })
  it('empty for no controls', () => expect(chainPoints(0, 176, 352)).toEqual([]))
})

describe('dots scale with the view again (as on main)', () => {
  it('dotSize no longer exists; the geometry dot is what the view multiplies by k', async () => {
    expect((await import('../../src/rings_layout.ts')).dotSize).toBeUndefined()
  })
})
