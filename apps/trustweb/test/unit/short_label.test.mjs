// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { shortLabel } from '../../src/short_label.ts'

describe('shortLabel', () => {
  it('keeps a name that fits', () => expect(shortLabel('Kaja Brave')).toBe('Kaja Brave'))
  it('keeps exactly max characters', () => expect(shortLabel('a'.repeat(20))).toBe('a'.repeat(20)))
  it('shows only the first name when the full name is too long', () => expect(shortLabel('Alexandra Montgomery-Smith')).toBe('Alexandra'))
  it('skips prefixes with a trailing dot', () => expect(shortLabel('Prof. Dr. Alexandra Montgomery-Smith')).toBe('Alexandra'))
  it('caps a long first name at 19 characters plus an ellipsis', () => expect(shortLabel('Wolfeschlegelsteinhausenbergerdorff Senior')).toBe('Wolfeschlegelsteinh…'))
  it('caps a single long token', () => expect(shortLabel('x'.repeat(30))).toBe('x'.repeat(19) + '…'))
  it('counts characters, not UTF-16 units', () => expect(shortLabel('😀'.repeat(25))).toBe('😀'.repeat(19) + '…'))
  it('keeps accents and non-latin scripts whole', () => expect(shortLabel('Zoë Özdemir-Papadopoulos Ünal')).toBe('Zoë'))
  it('falls back to the first token when every token is a prefix', () => expect(shortLabel('Dr. Prof. Mag. Hochwohlgeboren-Z.')).toBe('Dr.'))
  it('honours another max and trims spaces', () => expect(shortLabel('  Anna Maria  ', 6)).toBe('Anna'))
})
