// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { renamedTo } from '../../src/card_name.ts'

describe('card name edit (card_name.ts)', () => {
  it('takes the trimmed new name', () => {
    expect(renamedTo('Peter', '  Pete  ')).toBe('Pete')
  })
  it('keeps the old name when empty or blank: null = nothing to save', () => {
    expect(renamedTo('Peter', '')).toBeNull()
    expect(renamedTo('Peter', '   ')).toBeNull()
  })
  it('saves nothing when unchanged', () => {
    expect(renamedTo('Peter', 'Peter')).toBeNull()
    expect(renamedTo('Peter', ' Peter ')).toBeNull()
  })
  it('collapses inner whitespace and caps the length', () => {
    expect(renamedTo('P', 'Pe   ter')).toBe('Pe ter')
    expect(renamedTo('P', 'x'.repeat(200))?.length).toBe(40)
  })
})
