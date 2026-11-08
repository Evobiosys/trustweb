// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { settingsMatches, foldText } from '../../src/settings_search.ts'

describe('settings_search', () => {
  it('folds case and diacritics', () => {
    expect(foldText('Ärger  É')).toBe('arger e')
  })
  it('an empty query matches everything', () => {
    expect(settingsMatches('', 'anything')).toBe(true)
    expect(settingsMatches('   ', 'anything')).toBe(true)
  })
  it('matches label or hint text, ignoring case and accents', () => {
    expect(settingsMatches('EMAIL', 'Primary email address Stays on this phone')).toBe(true)
    expect(settingsMatches('prímary', 'Primary email address')).toBe(true)
    expect(settingsMatches('phone', 'Primary email address Stays on this phone')).toBe(true)
    expect(settingsMatches('backup', 'Primary email address')).toBe(false)
  })
  it('every word must be found, in any order', () => {
    expect(settingsMatches('address email', 'Primary email address')).toBe(true)
    expect(settingsMatches('address backup', 'Primary email address')).toBe(false)
  })
})
