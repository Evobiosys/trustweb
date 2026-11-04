// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 (whatsapp-beside): the default press opens a plain tab, the second button the popup at the right half. Pure. */
import { windowFeatures } from '../../src/ext/whatsapp/window.ts'

const g = { left: 1000, top: 40, width: 700, height: 700 }

describe('whatsapp window features per mode', () => {
  it('tab: no popup features, only noopener', () => {
    expect(windowFeatures('tab', g)).toBe('noopener')
    expect(windowFeatures('tab', g)).not.toContain('popup')
  })
  it('beside: popup at the given geometry', () => {
    expect(windowFeatures('beside', g)).toBe('popup=yes,left=1000,top=40,width=700,height=700')
  })
})
