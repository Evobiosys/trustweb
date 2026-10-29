// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { editKey } from '../../src/tap_edit.ts'

describe('tap to edit (tap_edit.ts)', () => {
  it('Enter saves, Escape cancels, other keys do nothing', () => {
    expect(editKey('Enter')).toBe('save')
    expect(editKey('Escape')).toBe('cancel')
    expect(editKey('a')).toBeNull()
  })
})
