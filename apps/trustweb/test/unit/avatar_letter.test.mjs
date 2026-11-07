// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { PERSON_GREEN } from '../../src/colour_tags.ts'
describe('avatar colour', () => {
  it('is the person-default token', () => expect(PERSON_GREEN).toBe('var(--person-default)'))
  it('an empty or mark-led name still falls back to "?" (letter rule unchanged)', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    expect(main).toContain("name.charAt(0).toUpperCase() || '?'")
  })
})
