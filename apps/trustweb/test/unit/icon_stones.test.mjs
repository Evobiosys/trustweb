// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-a: the Simple list view's icon is three flat stacked stones (src/icons.ts), inline SVG in the current colour. */
import { ICONS } from '../../src/icons.ts'

describe('stones icon', () => {
  const svg = ICONS.stones ?? ''
  it('exists as inline svg', () => expect(svg.startsWith('<svg')).toBe(true))
  it('has exactly three flat stones, widest at the bottom', () => {
    const rx = [...svg.matchAll(/<ellipse[^>]*cy="([\d.]+)"[^>]*rx="([\d.]+)"/g)].map((m) => ({ cy: Number(m[1]), rx: Number(m[2]) })).sort((a, b) => b.cy - a.cy)
    expect(rx).toHaveLength(3)
    expect(rx[0].rx).toBeGreaterThan(rx[1].rx)
    expect(rx[1].rx).toBeGreaterThan(rx[2].rx)
  })
  it('takes its colour from the surrounding text (no fixed colour)', () => expect(/#[0-9a-f]{3,6}|rgb|fill="(?!none|currentColor)/i.test(svg)).toBe(false))
})
