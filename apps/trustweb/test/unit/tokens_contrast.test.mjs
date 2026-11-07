// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { contrastRatio } from '../../src/design/contrast.mjs'
const t = JSON.parse(readFileSync(new URL('../../src/design/tokens.json', import.meta.url), 'utf8'))
const val = (theme, name) => name.startsWith('#') ? name : t.one[theme][name]

describe('contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#1F2A28', '#FAFAF7')).toBeGreaterThan(12)
  })
  it('composites rgba over the given backdrop', () => {
    expect(contrastRatio('rgba(0,0,0,1)', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('rgba(255,255,255,.5)', '#000000', { under: '#000000' })).toBeCloseTo(contrastRatio('#808080', '#000000'), 1)
  })
  for (const theme of ['light', 'dark']) {
    it(`${theme}: every text pair reaches 4.5:1`, () => {
      for (const [fg, bg] of t.contrast.text)
        expect(contrastRatio(val(theme, fg), val(theme, bg), { under: theme === 'light' ? '#FFFFFF' : '#1C1B17' }), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: every graphic pair reaches 3:1`, () => {
      for (const [fg, bg] of t.contrast.graphic)
        expect(contrastRatio(val(theme, fg), val(theme, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
    })
  }
})
