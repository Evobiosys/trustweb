// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { touchFromSync } from '../../src/touch_sync.ts'

const DAY = 86_400_000
const NOW = 5000 * DAY
const p = (id, o = {}) => ({ id, name: id, ring: 'friend', metAt: NOW - 400 * DAY, context: '', lines: [], ...o })

describe('touchFromSync', () => {
  it('stamps the last contact from a message of a synced channel', () => {
    const a = p('a')
    expect(touchFromSync({ people: [a] }, { personId: 'a', at: NOW - DAY })).toBe(true)
    expect(a.engagementKept).toBe(NOW - DAY)
  })
  it('is idempotent', () => {
    const a = p('a')
    touchFromSync({ people: [a] }, { personId: 'a', at: NOW })
    expect(touchFromSync({ people: [a] }, { personId: 'a', at: NOW })).toBe(false)
    expect(a.engagementKept).toBe(NOW)
  })
  it('never moves the time backwards, manual tap included', () => {
    const a = p('a', { engagementKept: NOW })
    expect(touchFromSync({ people: [a] }, { personId: 'a', at: NOW - 10 * DAY })).toBe(false)
    expect(a.engagementKept).toBe(NOW)
  })
  it('ignores a message older than the day we met, an unknown person, and the future', () => {
    const a = p('a')
    expect(touchFromSync({ people: [a] }, { personId: 'a', at: a.metAt - DAY })).toBe(false)
    expect(touchFromSync({ people: [a] }, { personId: 'zzz', at: NOW })).toBe(false)
    expect(touchFromSync({ people: [a] }, { personId: 'a', at: NOW + 2 * DAY }, NOW)).toBe(false)
    expect(a.engagementKept).toBeUndefined()
  })
  it('does not count a deleted person', () => {
    const d = p('d', { deleted_at: '2026-01-01T00:00:00Z', ring: 'none' })
    expect(touchFromSync({ people: [d] }, { personId: 'd', at: NOW })).toBe(false)
  })
})
