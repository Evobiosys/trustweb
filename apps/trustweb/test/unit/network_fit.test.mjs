// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Network view opens fitted and centred on the graph's own bounds (src/network_fit.ts). */
import { fitBounds } from '../../src/network_fit.ts'

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
})
