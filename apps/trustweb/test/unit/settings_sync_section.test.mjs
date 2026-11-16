// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-settings-sync: the Sync section at the bottom of Settings; on a phone the vault and Tana entries sit under its Advanced. */
import { syncSectionParts } from '../../src/settings_sync_section.ts'

const DESKTOP = { phone: false, tauri: false }
const PHONE = { phone: true, tauri: false }
const TAURI_PHONE = { phone: true, tauri: true }
const o = (env, eligible = true) => ({ env, eligible, devices: () => ['dev'], entries: () => ['obs', 'tana'] })

describe('syncSectionParts', () => {
  it('desktop: devices and both entries on the main surface', () => {
    expect(syncSectionParts(o(DESKTOP))).toEqual({ main: ['dev', 'obs', 'tana'], advanced: [] })
  })
  it('phone: devices stay, the vault and Tana entries go under Advanced', () => {
    expect(syncSectionParts(o(PHONE))).toEqual({ main: ['dev'], advanced: ['obs', 'tana'] })
  })
  it('a Tauri shell counts as a computer', () => {
    expect(syncSectionParts(o(TAURI_PHONE)).advanced).toEqual([])
  })
  it('a device that may not link others shows no device rows', () => {
    expect(syncSectionParts(o(DESKTOP, false))).toEqual({ main: ['obs', 'tana'], advanced: [] })
  })
})
