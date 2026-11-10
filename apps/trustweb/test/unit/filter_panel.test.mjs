// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-a: Filters and Tools open as an overlay sheet on a phone, inline above it (src/filter_panel.ts). */
import { SHEET_MAX_PX, panelMode } from '../../src/filter_panel.ts'

describe('panelMode', () => {
  it('a phone (600 px or narrower) gets the overlay sheet', () => {
    expect(SHEET_MAX_PX).toBe(600)
    for (const w of [320, 360, 414, 600]) expect(panelMode(w)).toBe('sheet')
  })
  it('anything wider stays inline', () => {
    for (const w of [601, 768, 1280]) expect(panelMode(w)).toBe('inline')
  })
})
