import { describe, expect, it } from 'vitest'
import { dateInputIn, daysUntil, dayKey, endOfDay, fmtDate, inputToAt, parseDateInput, todayInputValue } from '../../src/dates'

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()

describe('dates', () => {
  it('formats a local date with a fixed month table', () => {
    expect(fmtDate(at(2026, 10, 6))).toBe('6 Oct 2026')
    expect(fmtDate(at(2026, 9, 1))).toBe('1 Sep 2026')
    expect(fmtDate(Number.NaN)).toBe('')
  })

  it('keys a day in local time, zero padded', () => {
    expect(dayKey(at(2026, 3, 5, 23))).toBe('2026-03-05')
    expect(dayKey(at(2026, 3, 5, 0))).toBe('2026-03-05')
    expect(todayInputValue(at(2026, 12, 31))).toBe('2026-12-31')
  })

  it('counts calendar days, also across a clock change', () => {
    expect(daysUntil(at(2026, 10, 6, 23), at(2026, 10, 6, 1))).toBe(0)
    expect(daysUntil(at(2026, 10, 7, 0), at(2026, 10, 6, 23))).toBe(1)
    expect(daysUntil(at(2026, 3, 30), at(2026, 3, 28))).toBe(2)
    expect(daysUntil(at(2026, 10, 31), at(2026, 10, 24))).toBe(7)
    expect(daysUntil(at(2026, 10, 4), at(2026, 10, 6))).toBe(-2)
  })

  it('parses a date input to local midnight and refuses impossible dates', () => {
    expect(parseDateInput('2026-10-06')).toBe(new Date(2026, 9, 6).getTime())
    expect(parseDateInput('2026-02-30')).toBeNull()
    expect(parseDateInput('2026-13-01')).toBeNull()
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('6 Oct')).toBeNull()
  })

  it('adds days on the calendar and ends a day at its last millisecond', () => {
    expect(dateInputIn(7, at(2026, 10, 28))).toBe('2026-11-04')
    expect(dayKey(endOfDay(at(2026, 10, 6, 3)))).toBe('2026-10-06')
    expect(dayKey(endOfDay(at(2026, 10, 6, 3)) + 1)).toBe('2026-10-07')
  })

  it('keeps the clock time for today and uses midnight for another day', () => {
    const now = at(2026, 10, 6, 15)
    expect(inputToAt('2026-10-06', now)).toBe(now)
    expect(inputToAt('2026-10-01', now)).toBe(new Date(2026, 9, 1).getTime())
    expect(inputToAt('garbage', now)).toBe(now)
  })
})
