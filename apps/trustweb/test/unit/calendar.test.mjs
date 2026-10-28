// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar module (wave 24, cal1): pure date maths and the registry. */
import { addMonths, dayCounts, eventsOn, monthGrid } from '../../src/ext/calendar/calendar.ts'
import { EXT_MODULES } from '../../src/ext/registry.ts'

const ev = (id, from, to) => ({ id, name: id, from, ...(to ? { to } : {}), where: '', createdAt: 0, attended: true })

describe('monthGrid', () => {
  it('Feb 2026 starts on a Sunday: the first row begins Mon 2026-01-26', () => {
    const g = monthGrid(2026, 1)
    expect(g[0][0]).toBe('2026-01-26')
    expect(g[0][6]).toBe('2026-02-01')
    expect(g).toHaveLength(5)
    expect(g.at(-1)[6]).toBe('2026-03-01')
  })
  it('leap Feb 2028 holds the 29th', () => {
    expect(monthGrid(2028, 1).flat()).toContain('2028-02-29')
    expect(monthGrid(2027, 1).flat()).not.toContain('2027-02-29')
  })
  it('has 4 to 6 rows of 7', () => {
    for (let m = 0; m < 12; m++) {
      const g = monthGrid(2026, m)
      expect(g.length).toBeGreaterThanOrEqual(4)
      expect(g.length).toBeLessThanOrEqual(6)
      g.forEach((w) => expect(w).toHaveLength(7))
    }
  })
})

describe('addMonths', () => {
  it('rolls the year both ways', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month0: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month0: 11 })
    expect(addMonths(2026, 5, 0)).toEqual({ year: 2026, month0: 5 })
  })
})

describe('eventsOn / dayCounts', () => {
  const list = [ev('a', '2026-10-12', '2026-10-14'), ev('b', '2026-10-13T09:00'), ev('c', '2026-10-13')]
  it('a multi-day event covers 3 days', () => {
    expect(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d) => eventsOn(list, d).some((e) => e.id === 'a')))
      .toEqual([false, true, true, true, false])
  })
  it('date-only and date+time from both land on their day, sorted by from', () => {
    expect(eventsOn(list, '2026-10-13').map((e) => e.id)).toEqual(['a', 'c', 'b'])
  })
  it('empty', () => {
    expect(eventsOn([], '2026-10-13')).toEqual([])
    expect(dayCounts([], ['2026-10-13'])).toEqual({})
  })
  it('counts only days with events', () => {
    expect(dayCounts(list, ['2026-10-12', '2026-10-13', '2026-10-20'])).toEqual({ '2026-10-12': 1, '2026-10-13': 3 })
  })
})

describe('registry', () => {
  it('has unique ids and the calendar', () => {
    const ids = EXT_MODULES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('calendar')
  })
})
