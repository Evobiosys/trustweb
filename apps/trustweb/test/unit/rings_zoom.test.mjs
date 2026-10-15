/** The pure zoom and pan maths of the Web rings (src/rings_zoom.ts). */
import { RINGS_ZOOM_MAX, panBy, toLocal, transformOf, zoomAt } from '../../src/rings_zoom.ts'

const home = { k: 1, x: 0, y: 0 }

describe('rings zoom', () => {
  it('clamps k to 1 and the maximum', () => {
    expect(zoomAt(home, 0.5, 100, 100)).toEqual(home)
    expect(zoomAt(home, 100, 100, 100).k).toBe(RINGS_ZOOM_MAX)
    expect(zoomAt(zoomAt(home, 100, 0, 0), 100, 0, 0).k).toBe(RINGS_ZOOM_MAX)
  })
  it('keeps the point under the pointer fixed', () => {
    const z = zoomAt(home, 2, 100, 100)
    const p = toLocal(z, 100, 100)
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.y).toBeCloseTo(100, 6)
    const z2 = zoomAt(z, 1.5, 200, 150)
    const before = toLocal(z, 200, 150)
    const after = toLocal(z2, 200, 150)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
  it('clamps the pan so the content never leaves the box', () => {
    const z = zoomAt(home, 2, 176, 176)
    expect(panBy(z, 1000, 1000, 352)).toMatchObject({ x: 0, y: 0 })
    expect(panBy(z, -1000, -1000, 352)).toMatchObject({ x: -352, y: -352 })
    expect(panBy(home, 50, 50, 352)).toEqual(home)
  })
  it('resets the pan when k returns to 1', () => {
    const z = zoomAt(home, 2, 300, 300)
    expect(z.x).toBeLessThan(0)
    expect(zoomAt(z, 0.1, 300, 300)).toEqual(home)
  })
  it('toLocal inverts the transform', () => {
    const z = zoomAt(home, 3, 50, 250)
    const c = { x: 120, y: 80 }
    expect(toLocal(z, c.x * z.k + z.x, c.y * z.k + z.y)).toEqual({ x: expect.closeTo(120, 6), y: expect.closeTo(80, 6) })
  })
  it('writes no transform at k = 1', () => {
    expect(transformOf(home)).toBe('')
    expect(transformOf({ k: 2, x: -10, y: -20 })).toBe('translate(-10px, -20px) scale(2)')
  })
})
