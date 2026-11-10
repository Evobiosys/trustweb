// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 rings-column-dark: the diamond/expand column is a keep-out sector for dots. */
import { columnSector, avoidSector, nudgeAngles, ringsGeometry, spaceOut } from '../../src/rings_layout.ts'
import { Ring } from '../../src/model.ts'

// Column relative to the rings centre: x = left edge, w = width, cy = centre y (down), h = height.
const col = { x: -10, w: 60, cy: 100, h: 160 }

describe('columnSector', () => {
  it('is centred on 6 o\'clock (180°) for a ring the column crosses', () => {
    const [a0, a1] = columnSector(100, col)
    expect(a0).toBeLessThan(180)
    expect(a1).toBeGreaterThan(180)
  })
  it('widens by the dot radius (pad)', () => {
    const [a0, a1] = columnSector(100, col)
    const [b0, b1] = columnSector(100, col, 10)
    expect(b0).toBeLessThan(a0)
    expect(b1).toBeGreaterThan(a1)
  })
  it('is null for a ring that ends above the column', () => {
    expect(columnSector(10, col)).toBeNull()
  })
  it('no point of the ring inside the sector lies outside the column, none outside lies in it', () => {
    const R = 100
    const [a0, a1] = columnSector(R, col)
    for (let a = 0; a < 360; a += 0.5) {
      const x = R * Math.sin((a * Math.PI) / 180), y = -R * Math.cos((a * Math.PI) / 180)
      const inCol = x >= col.x && x <= col.x + col.w && y >= col.cy - col.h / 2 && y <= col.cy + col.h / 2
      const inSector = a >= a0 - 1e-6 && a <= a1 + 1e-6
      if (inCol) expect(inSector).toBe(true)
    }
  })
})

describe('avoidSector', () => {
  it('leaves an angle outside the sector alone', () => {
    expect(avoidSector(90, [160, 200])).toBe(90)
    expect(avoidSector(90, null)).toBe(90)
  })
  it('snaps an angle inside to the nearest edge', () => {
    expect(avoidSector(170, [160, 200])).toBe(160)
    expect(avoidSector(190, [160, 200])).toBe(200)
  })
})

describe('nudgeAngles with a keep-out', () => {
  it('never draws a dot inside the sector, even when its own angle is there', () => {
    const keepOut = () => [160, 200]
    const out = nudgeAngles([{ id: 'a', angle: 180, radius: 100, r: 10 }, { id: 'b', angle: 175, radius: 100, r: 10 }, { id: 'c', angle: 185, radius: 100, r: 10 }], [], 176, keepOut)
    for (const a of out.values()) expect(a <= 160 || a >= 200).toBe(true)
  })
})

describe('spaceOut with a keep-out', () => {
  it('moves no stored angle into the sector', () => {
    const s = { expanse: [], people: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P', ring: Ring.Friend, context: '', metAt: 1, lines: [] })) }
    spaceOut(s, undefined, (a) => avoidSector(a, [160, 200]))
    for (const p of s.people) expect(p.angle <= 160 || p.angle >= 200).toBe(true)
  })
})

describe('ringsGeometry with the user own ring radii (wave 39)', () => {
  const counts = { closest: 2, close: 2, friend: 2, acquaintance: 2, intending: 2 }
  it('draws a ring at the radius the user dragged it to', () => {
    expect(ringsGeometry(counts, {}, 1, { friend: 120 }).radius.friend).toBe(120)
  })
  it('without a custom radius the rings keep their default place', () => {
    expect(ringsGeometry(counts, {}, 1).radius.friend).toBe(ringsGeometry(counts, {}, 1, {}).radius.friend)
  })
  it('the extent follows the outermost ring', () => {
    expect(ringsGeometry(counts, {}, 1, { intending: 220 }).extent).toBeGreaterThan(220)
  })
})
