/** The pure zoom and pan maths of the Web rings (src/rings_zoom.ts). */
import { RINGS_ZOOM_MAX, panBy, transformOf, zoomAt } from '../../src/rings_zoom.ts'

const home = { k: 1, x: 0, y: 0 }
const v = { w: 352, h: 600, cw: 352, ch: 500 }
const toLocal = (z, px, py) => ({ x: (px - z.x) / z.k, y: (py - z.y) / z.k })

describe('rings zoom', () => {
  it('clamps k to 1 and the maximum', () => {
    expect(zoomAt(home, 0.5, 100, 100, v)).toEqual(home)
    expect(zoomAt(home, 100, 100, 100, v).k).toBe(RINGS_ZOOM_MAX)
    expect(zoomAt(zoomAt(home, 100, 0, 0, v), 100, 0, 0, v).k).toBe(RINGS_ZOOM_MAX)
  })
  it('keeps the point under the pointer fixed', () => {
    const z = zoomAt(home, 2, 100, 100, v)
    const p = toLocal(z, 100, 100)
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.y).toBeCloseTo(100, 6)
    const z2 = zoomAt(z, 1.5, 200, 150, v)
    const before = toLocal(z, 200, 150)
    const after = toLocal(z2, 200, 150)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
  it('clamps the pan so the content never leaves the box', () => {
    const z = zoomAt(home, 2, 176, 176, v)
    expect(panBy(z, 1000, 1000, v)).toMatchObject({ x: 0, y: 0 })
    expect(panBy(z, -1000, -1000, v)).toMatchObject({ x: -352, y: -700 })
    expect(panBy(home, 50, 50, v)).toEqual(home)
  })
  it('resets the pan when k returns to 1', () => {
    const z = zoomAt(home, 2, 300, 300, v)
    expect(z.x).toBeLessThan(0)
    expect(zoomAt(z, 0.1, 300, 300, v)).toEqual(home)
  })
  it('toLocal inverts the transform', () => {
    const z = zoomAt(home, 3, 50, 250, v)
    const c = { x: 120, y: 80 }
    expect(toLocal(z, c.x * z.k + z.x, c.y * z.k + z.y)).toEqual({ x: expect.closeTo(120, 6), y: expect.closeTo(80, 6) })
  })
  it('does not pan a short page past its own height', () => {
    expect(panBy(zoomAt(home, 1.2, 0, 0, { ...v, h: 300 }), 0, -999, { ...v, h: 300 }).y).toBe(0)
  })
  it('writes no transform at k = 1', () => {
    expect(transformOf(home)).toBe('')
    expect(transformOf({ k: 2, x: -10, y: -20 })).toBe('translate(-10px, -20px) scale(2)')
  })
})
