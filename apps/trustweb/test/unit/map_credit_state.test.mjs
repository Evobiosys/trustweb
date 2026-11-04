// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { toggleMapCredit } from '../../src/map_credit_state.ts'

describe('map credit toggle', () => {
  it('opens a closed popover', () => {
    expect(toggleMapCredit(false)).toBe(true)
  })
  it('closes an open popover', () => {
    expect(toggleMapCredit(true)).toBe(false)
  })
})
