// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Sync mode per device (R52): 'phoneHolds' stops a non-phone device from sending; the phone always sends. */
import { SYNC_MODE_KEY, readSyncMode, shouldSend, writeSyncMode } from '../../src/sync_mode.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

describe('sync mode', () => {
  it('defaults to mirror, ignores junk, round-trips', () => {
    const st = mem()
    expect(readSyncMode(st)).toBe('mirror')
    st.setItem(SYNC_MODE_KEY, 'x')
    expect(readSyncMode(st)).toBe('mirror')
    writeSyncMode('phoneHolds', st)
    expect(readSyncMode(st)).toBe('phoneHolds')
    writeSyncMode('mirror', st)
    expect(readSyncMode(st)).toBe('mirror')
  })
  it('only a non-phone device with phoneHolds does not send', () => {
    expect(shouldSend('mirror', false)).toBe(true)
    expect(shouldSend('mirror', true)).toBe(true)
    expect(shouldSend('phoneHolds', true)).toBe(true)
    expect(shouldSend('phoneHolds', false)).toBe(false)
  })
})

