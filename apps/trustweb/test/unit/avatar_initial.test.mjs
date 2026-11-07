// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 rings-column-dark: the initial inside an avatar stays readable in both themes. */
import { readFileSync } from 'node:fs'
import { contrastRatio } from '../../src/design/contrast.mjs'
import { initialColor } from '../../src/avatar_initial.ts'
const t = JSON.parse(readFileSync(new URL('../../src/design/tokens.json', import.meta.url), 'utf8'))
const hex = (theme, v) => t.one[theme][v.replace(/^var\(--|\)$/g, '')]

describe('initialColor', () => {
  it('filled uses --on-person, light fills --ring-ink, outlined --ink', () => {
    expect(initialColor('filled')).toBe('var(--on-person)')
    expect(initialColor('light')).toBe('var(--ring-ink)')
    expect(initialColor('outlined')).toBe('var(--ink)')
  })
  for (const theme of ['light', 'dark']) {
    it(`${theme}: an outlined initial reaches 4.5:1 on every surface it can sit on`, () => {
      for (const bg of ['surface-0', 'surface-1', 'raised']) expect(contrastRatio(hex(theme, initialColor('outlined')), t.one[theme][bg], { under: t.one[theme]['surface-0'] })).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: dark-brown initials reach 4.5:1 on the light ring fills`, () => {
      for (const fill of ['#F6A24F', '#FAC98F']) expect(contrastRatio(hex(theme, initialColor('light')), fill)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
