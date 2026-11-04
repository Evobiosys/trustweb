// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Ring handles (the ⊖/⊕ and ⛶ buttons) never cover a person dot (src/ring_handles.ts). */
import { placeHandles, HANDLE } from '../../src/ring_handles.ts'

const C = 176
const onRing = (R, deg) => { const a = (deg * Math.PI) / 180; return { x: C + R * Math.sin(a), y: C - R * Math.cos(a), r: 7 } }
const clear = (h, dots) => [h.toggle, h.more].filter(Boolean).every((p) => dots.every((d) => Math.hypot(p.left - d.x, p.top - d.y) >= HANDLE / 2 + d.r + 4))

describe('ring handles', () => {
  it('an empty ring keeps the handles at 12 o\'clock, the fill button 16 px to the right', () => {
    const h = placeHandles({ centre: C, radius: 100, dots: [], outer: 170, size: 352, more: true })
    expect(h.kind).toBe('arc')
    expect(h.toggle).toEqual({ left: C, top: C - 100 })
    expect(h.more).toEqual({ left: C + 16, top: C - 100 })
  })

  it('no fill button: only the toggle is placed', () => {
    const h = placeHandles({ centre: C, radius: 100, dots: [], outer: 170, size: 352, more: false })
    expect(h.more).toBeUndefined()
  })

  it('dots at 12 o\'clock move the handles to the next free arc (1:30 first)', () => {
    const dots = [onRing(100, 0), onRing(100, 6), onRing(100, -6)]
    const h = placeHandles({ centre: C, radius: 100, dots, outer: 170, size: 352, more: true })
    expect(h.kind).toBe('arc')
    expect(h.angle).toBe(45)
    expect(clear(h, dots)).toBe(true)
  })

  it('1:30 taken too: 10:30 is next', () => {
    const dots = [onRing(100, 0), onRing(100, 45)]
    const h = placeHandles({ centre: C, radius: 100, dots, outer: 170, size: 352, more: true })
    expect(h.angle).toBe(-45)
  })

  it('a dense ring lifts the handles onto a tab outside the rings, clear of every dot', () => {
    const dots = Array.from({ length: 238 }, (_, i) => onRing(160 - (i % 3) * 6, (i * 360) / 238))
    const h = placeHandles({ centre: C, radius: 160, dots, outer: 170, size: 352, more: true })
    expect(h.kind).toBe('tab')
    expect(clear(h, dots)).toBe(true)
    expect(Math.hypot(h.toggle.left - C, h.toggle.top - C)).toBeGreaterThan(170)
  })

  it('a second ring does not take a slot an earlier handle holds', () => {
    const first = placeHandles({ centre: C, radius: 100, dots: [], outer: 170, size: 352, more: true })
    const held = [{ x: first.toggle.left, y: first.toggle.top, r: HANDLE / 2 }, { x: first.more.left, y: first.more.top, r: HANDLE / 2 }]
    const second = placeHandles({ centre: C, radius: 106, dots: held, outer: 170, size: 352, more: true })
    expect(clear(second, held)).toBe(true)
  })
})
