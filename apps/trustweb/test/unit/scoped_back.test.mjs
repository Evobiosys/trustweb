// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 event-back-button: the screen a scoped page's Back returns to. */
import { backScreen } from '../../src/scoped_back.ts'

describe('backScreen', () => {
  it('returns the screen the page was reached from', () => { expect(backScreen('events', 'inventory', 'web')).toBe('events') })
  it('falls back when the page was opened from nowhere (reload, deep link)', () => { expect(backScreen(null, 'inventory', 'web')).toBe('web') })
  it('never loops onto the page itself', () => { expect(backScreen('inventory', 'inventory', 'web')).toBe('web') })
})
