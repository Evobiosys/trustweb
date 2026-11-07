// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { CADENCE_CHOICES, nextReminder, isOverdue } from '../../src/cadence.ts'

const DAY = 86_400_000
const p = (o = {}) => ({ id: 'a', name: 'A', metAt: 1000 * DAY, ...o })

describe('cadence', () => {
  it('offers week, fortnight, month, quarter, half year, year', () => {
    expect(CADENCE_CHOICES).toEqual([7, 14, 30, 90, 180, 365])
  })
  it('has no reminder while the cadence is off', () => {
    expect(nextReminder(p(), 5 * DAY, 10 * DAY)).toBeUndefined()
    expect(isOverdue(p(), 5 * DAY, 99999 * DAY)).toBe(false)
  })
  it('counts N days from the last contact', () => {
    expect(nextReminder(p({ cadenceDays: 30 }), 2000 * DAY, 2001 * DAY)).toBe(2030 * DAY)
  })
  it('falls back to the day we met, then to now', () => {
    expect(nextReminder(p({ cadenceDays: 7 }), undefined, 3000 * DAY)).toBe(1007 * DAY)
    expect(nextReminder(p({ cadenceDays: 7, metAt: 0 }), undefined, 3000 * DAY)).toBe(3007 * DAY)
  })
  it('is overdue from the reminder day on', () => {
    const q = p({ cadenceDays: 14 })
    expect(isOverdue(q, 2000 * DAY, 2013 * DAY)).toBe(false)
    expect(isOverdue(q, 2000 * DAY, 2014 * DAY)).toBe(true)
  })
})
