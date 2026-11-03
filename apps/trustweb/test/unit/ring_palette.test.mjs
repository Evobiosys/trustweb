// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b zones-network-2: one palette for the TrustZones rings and the Network nodes (src/ring_palette.ts). */
import { readFileSync } from 'node:fs'
import { Ring } from '../../src/model.ts'
import { RING_HEX, ringColor } from '../../src/ring_palette.ts'
import { TONE_ORDER } from '../../src/trustzones.ts'

describe('ring palette', () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  it('every rung has the colour of its --ring-N token in styles.css (TrustZones)', () => {
    TONE_ORDER.forEach((r, i) => expect(ringColor(r).toLowerCase()).toBe(css.match(new RegExp(`--ring-${i}:\\s*(#[0-9a-fA-F]{6})`))[1].toLowerCase()))
  })
  it('six distinct rungs; "outside" takes the outermost grey like not yet sorted', () => {
    expect(new Set(RING_HEX).size).toBe(6)
    expect(ringColor('outside')).toBe(ringColor(Ring.Unsorted))
  })
})
