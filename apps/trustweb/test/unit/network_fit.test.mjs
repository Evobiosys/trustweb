// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Network view opens fitted and centred on the graph's own bounds (src/network_fit.ts). */
import { fitBounds, refitCamera } from '../../src/network_fit.ts'

describe('network fit', () => {
  it('centres a graph that sits off the origin', () => {
    const c = fitBounds([{ x: 100, y: 200, r: 6 }, { x: 300, y: 260, r: 6 }], 400, 600)
    // the bounds centre (200, 230) lands on the box centre
    expect(200 * c.k + c.x).toBeCloseTo(200, 5)
    expect(230 * c.k + c.y).toBeCloseTo(300, 5)
  })

  it('fits the whole graph inside the box with a margin', () => {
    const c = fitBounds([{ x: -500, y: -10, r: 6 }, { x: 500, y: 10, r: 6 }], 400, 600)
    expect(1000 * c.k).toBeLessThanOrEqual(400)
  })

  it('does not blow a tiny graph up past 1.5x', () => {
    expect(fitBounds([{ x: 0, y: 0, r: 6 }], 400, 600).k).toBe(1.5)
  })

  describe('refit when the canvas size changes', () => {
    const nodes = [{ x: 100, y: 200, r: 6 }, { x: 300, y: 260, r: 6 }]
    it('an untouched camera is fitted again to the new size', () => {
      const old = fitBounds(nodes, 200, 300)
      const c = refitCamera(old, false, nodes, { w: 200, h: 300 }, { w: 1000, h: 500 })
      expect(c).toEqual(fitBounds(nodes, 1000, 500))
    })

    it('a camera the user moved keeps its picture, centred on the same spot of the new box', () => {
      const mine = { k: 2, x: 10, y: 20 }
      const c = refitCamera(mine, true, nodes, { w: 200, h: 300 }, { w: 1000, h: 500 })
      expect(c).toEqual({ k: 2, x: 410, y: 120 })
    })

    it('a touched camera without a known earlier size stays as it is', () => {
      const mine = { k: 2, x: 10, y: 20 }
      expect(refitCamera(mine, true, nodes, null, { w: 1000, h: 500 })).toBe(mine)
      expect(refitCamera(null, true, nodes, null, { w: 1000, h: 500 })).toBeNull()
    })
  })
})
