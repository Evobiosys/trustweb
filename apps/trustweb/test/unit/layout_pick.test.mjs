// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the layout picker, TrustWeb (responsive) vs TrustWeb mobile (phone frame). */
import { LAYOUT_KEY, isPhone, pickLayout } from '../../src/layout_pick.ts'

describe('pickLayout', () => {
  it('a desktop defaults to the responsive TrustWeb layout', () => expect(pickLayout(null, false)).toBe('trustweb'))
  it('a phone defaults to TrustWeb mobile', () => expect(pickLayout(null, true)).toBe('mobile'))
  it('a stored choice wins on both', () => {
    expect(pickLayout('mobile', false)).toBe('mobile')
    expect(pickLayout('trustweb', true)).toBe('trustweb')
  })
  it('garbage reads as absent', () => {
    expect(pickLayout('desk', false)).toBe('trustweb')
    expect(pickLayout('x', true)).toBe('mobile')
  })
  it('a phone is a coarse pointer under 700 px', () => {
    expect(isPhone(true, 390)).toBe(true)
    expect(isPhone(true, 800)).toBe(false)
    expect(isPhone(false, 390)).toBe(false)
  })
  it('the key sits in the trustweb.ui family', () => expect(LAYOUT_KEY).toBe('trustweb.ui.layout'))
})
