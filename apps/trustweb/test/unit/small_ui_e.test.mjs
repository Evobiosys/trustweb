// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 small-ui-e: the Web zoom-out floor (the outer ring fits the clip with a small margin) and the AI settings section. */
import { RINGS_FIT_MARGIN, minZoom, panBy, zoomAt } from '../../src/rings_zoom.ts'

const home = { k: 1, x: 0, y: 0 }

describe('minZoom (the outermost ring fits the clip with a small margin)', () => {
  it('desktop 1280x800: the clip height decides; screenshot 44c47d0b shows k about 1.43', () => {
    const k = minZoom(176, 1280, 624)
    expect(k).toBeCloseTo(624 / (2 * (176 + RINGS_FIT_MARGIN)), 6)
    expect(k).toBeGreaterThan(1.35)
    expect(k).toBeLessThan(1.5)
  })
  it('a narrow clip: the width decides', () => { expect(minZoom(176, 700, 2000)).toBeCloseTo(700 / (2 * (176 + RINGS_FIT_MARGIN)), 6) })
  it('a phone never zooms out below the layout it already has', () => {
    expect(minZoom(176, 360, 518)).toBe(1)
    expect(minZoom(176, 390, 844)).toBe(1)
  })
  it('a smaller extent (few rings) allows a bigger floor; no extent or no clip = 1', () => {
    expect(minZoom(100, 1280, 624)).toBeGreaterThan(minZoom(176, 1280, 624))
    expect(minZoom(0, 1280, 624)).toBe(1)
    expect(minZoom(176, 0, 0)).toBe(1)
  })
})

describe('zoomAt stops at the floor', () => {
  const v = { w: 1280, h: 352, cw: 1280, ch: 624, minK: 1.44 }
  it('zooming out never goes below minK, from any k, by any factor', () => {
    const at = zoomAt({ k: 2, x: -300, y: 0 }, 0.01, 640, 200, v)
    expect(at.k).toBe(1.44)
    expect(zoomAt(at, 0.5, 640, 200, v).k).toBe(1.44)
    expect(zoomAt({ k: 1.6, x: -400, y: 0 }, 0.9, 640, 200, v).k).toBeCloseTo(1.44, 6)
  })
  it('zooming out by small steps lands on the floor, not under it', () => {
    let z = { k: 3, x: -500, y: 0 }
    for (let i = 0; i < 40; i++) z = zoomAt(z, 0.9, 640, 200, v)
    expect(z.k).toBe(1.44)
  })
  it('zoom in keeps its maximum', () => { expect(zoomAt(zoomAt(home, 100, 640, 200, v), 100, 640, 200, v).k).toBe(4) })
  it('without minK the floor is 1 as before', () => { expect(zoomAt({ k: 2, x: -10, y: 0 }, 0.01, 0, 0, { w: 352, h: 352, cw: 352, ch: 500 })).toEqual(home) })
})

describe('vertical centring at the floor (desktop fit)', () => {
  const v = { w: 1280, h: 352, cw: 1280, ch: 624, minK: 1.44 }
  it('content shorter than the clip sits centred; no vertical pan', () => {
    const z = zoomAt({ k: 2, x: -300, y: -50 }, 0.01, 640, 200, v)
    expect(z.y).toBeCloseTo((624 - 352 * 1.44) / 2, 6)
    expect(panBy(z, 0, -500, v).y).toBeCloseTo((624 - 352 * 1.44) / 2, 6)
  })
  it('taller content pans between its edges as before', () => {
    const tall = { ...v, h: 600 }
    expect(panBy({ k: 2, x: 0, y: 0 }, 0, -9999, tall).y).toBe(624 - 600 * 2)
    expect(panBy({ k: 2, x: 0, y: 0 }, 0, 50, tall).y).toBe(0)
  })
  it('phones (no floor above 1) keep the top-aligned rule', () => {
    expect(zoomAt(home, 1.2, 0, 0, { w: 352, h: 300, cw: 352, ch: 500, minK: 1 }).y).toBe(0)
  })
})

// Wave 41 review-fixes c (rf41-c)
import { RINGS_ZOOM_MAX, floorZoom, reclamp } from '../../src/rings_zoom.ts'

describe('rf41-c C1 floorZoom: the floor only where the first fit applied', () => {
  const w = 352, h = 352, ext = 176
  it('1280x720 (clip height 544, no first fit): floor 1, home k=1 stays reachable', () => { expect(floorZoom(ext, w, h, 1280, 544)).toBe(1) })
  it('360x640 phone: floor 1', () => { expect(floorZoom(ext, w, h, 360, 560)).toBe(1) })
  it('1280x800 (clip 624): floor keeps 1.444', () => { expect(floorZoom(ext, w, h, 1280, 624)).toBeCloseTo(1.4444, 3) })
  it('a phone with rings dragged inward (extent 100): still 1', () => { expect(floorZoom(100, w, h, 360, 500)).toBe(1) })
})
describe('rf41-c C2/C3 minZoom bounds', () => {
  it('never above the zoom-in maximum (4K portrait)', () => { expect(minZoom(100, 3000, 3000)).toBe(RINGS_ZOOM_MAX) })
  it('NaN / Infinity inputs give 1', () => {
    expect(minZoom(NaN, 1280, 624)).toBe(1)
    expect(minZoom(Infinity, 1280, 624)).toBe(1)
    expect(minZoom(176, NaN, 624)).toBe(1)
    expect(minZoom(176, 1280, Infinity)).toBe(1)
  })
})
describe('rf41-c C4 reclamp', () => {
  const v = { w: 1280, h: 352, cw: 1280, ch: 800, minK: 1.9 }
  it('a stored k under a grown floor is raised to it; a k above stays', () => {
    expect(reclamp({ k: 1.44, x: 0, y: 0 }, v).k).toBeCloseTo(1.9, 6)
    expect(reclamp({ k: 2.5, x: -10, y: 0 }, v).k).toBe(2.5)
    expect(reclamp({ k: 1, x: 0, y: 0 }, { ...v, minK: 1 })).toEqual({ k: 1, x: 0, y: 0 })
  })
})
