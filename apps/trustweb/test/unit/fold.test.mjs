// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: collapsible sections remember their state per section (fold.ts). */
import { foldOpen, foldStored, foldKey } from '../../src/fold.ts'

describe('fold', () => {
  it('absent = the section default; a stored value wins', () => {
    expect(foldOpen(null, true)).toBe(true)
    expect(foldOpen(null, false)).toBe(false)
    expect(foldOpen('0', true)).toBe(false)
    expect(foldOpen('1', false)).toBe(true)
    expect(foldStored(true)).toBe('1')
    expect(foldKey('days')).toBe('trustweb.ui.fold.days')
  })
})
