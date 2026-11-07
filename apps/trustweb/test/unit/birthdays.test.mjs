// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { completeRows } from '../../src/complete_view_model.ts'
import { parseBirthday, birthdayOf, upcoming, noticeText, birthdayRemindersOn, birthdayNoticeDue, notifyBirthdays, dismissAction } from '../../src/birthdays.ts'

const p = (id, birthday, o = {}) => ({ id, name: id, ring: 'friend', metAt: 0, context: '', lines: [], ...(birthday ? { fields: { birthday } } : {}), ...o })
const TODAY = new Date(2026, 10, 7, 9, 0)

describe('parseBirthday', () => {
  it('reads the import forms and the typed forms', () => {
    expect(parseBirthday('1988-03-14')).toEqual({ month: 3, day: 14, year: 1988 })
    expect(parseBirthday('--03-14')).toEqual({ month: 3, day: 14 })
    expect(parseBirthday('03-14')).toEqual({ month: 3, day: 14 })
    expect(parseBirthday('14.03.1988')).toEqual({ month: 3, day: 14, year: 1988 })
    expect(parseBirthday('14.3.')).toEqual({ month: 3, day: 14 })
  })
  it('refuses nonsense and impossible dates', () => {
    for (const bad of ['', 'soon', '1988-13-01', '--02-30', '00-10', undefined]) expect(parseBirthday(bad)).toBeNull()
  })
  it('birthdayOf reads fields.birthday', () => {
    expect(birthdayOf(p('a', '--11-07'))).toEqual({ month: 11, day: 7 })
    expect(birthdayOf(p('b'))).toBeNull()
  })
})

describe('upcoming', () => {
  it('lists today first, then by days away, with age when the year is known', () => {
    const r = upcoming([p('later', '1990-11-12'), p('today', '1980-11-07'), p('noyear', '--11-09')], TODAY, 7)
    expect(r.map((x) => [x.person.id, x.daysAway, x.age, x.isToday])).toEqual([['today', 0, 46, true], ['noyear', 2, undefined, false], ['later', 5, 36, false]])
  })
  it('stays inside the horizon and wraps over New Year', () => {
    const dec = new Date(2026, 11, 29)
    expect(upcoming([p('a', '--01-02'), p('b', '--01-20')], dec, 7).map((x) => [x.person.id, x.daysAway])).toEqual([['a', 4]])
    expect(upcoming([p('a', '2000-01-02')], dec, 7)[0].age).toBe(27)
  })
  it('puts 29 February on 28 February in a year without one', () => {
    expect(upcoming([p('leap', '2000-02-29')], new Date(2027, 1, 28), 0).map((x) => x.person.id)).toEqual(['leap'])
    expect(upcoming([p('leap', '2000-02-29')], new Date(2028, 1, 28), 0)).toEqual([])
  })
  it('skips deleted and archived people', () => {
    const gone = p('d', '--11-07', { deleted_at: '2026-01-01T00:00:00Z', ring: 'none' })
    const arch = p('x', '--11-07', { ring: 'none' })
    expect(upcoming([gone, arch, p('ok', '--11-07')], TODAY, 3).map((x) => x.person.id)).toEqual(['ok'])
  })
})

describe('noticeText', () => {
  it('names today and this week apart, three names at most', () => {
    const list = upcoming([p('A', '--11-07'), p('B', '--11-08'), p('C', '--11-09'), p('D', '--11-10'), p('E', '--11-11')], TODAY, 7)
    expect(noticeText(list)).toBe('Birthday today: A. This week: B, C, D and 1 more.')
    expect(noticeText(list.slice(1, 2))).toBe('This week: B.')
    expect(noticeText([])).toBe('')
  })
})

describe('setting and daily stamp', () => {
  it('is on unless switched off', () => {
    expect(birthdayRemindersOn({})).toBe(true)
    expect(birthdayRemindersOn({ birthdayReminders: false })).toBe(false)
  })
  it('is due once per local day', () => {
    expect(birthdayNoticeDue({}, TODAY)).toBe(true)
    expect(birthdayNoticeDue({ birthdayNoticeDay: '2026-11-07' }, TODAY)).toBe(false)
    expect(birthdayNoticeDue({ birthdayNoticeDay: '2026-11-06' }, TODAY)).toBe(true)
  })
  it('notifyBirthdays hands the text to the shower and says whether it showed', () => {
    const shown = []
    expect(notifyBirthdays(upcoming([p('A', '--11-07')], TODAY, 7), (t) => shown.push(t))).toBe(true)
    expect(shown).toEqual(['Birthday today: A.'])
    expect(notifyBirthdays([], (t) => shown.push(t))).toBe(false)
    expect(shown).toHaveLength(1)
  })
})

describe('dismissAction', () => {
  it('"Never show again" turns the Birthday reminders setting off, and the reminders then read as off', () => {
    const s = {}
    expect(birthdayRemindersOn(s)).toBe(true)
    dismissAction(s)
    expect(s.birthdayReminders).toBe(false)
    expect(birthdayRemindersOn(s)).toBe(false)
  })
})

describe('Birthdays chip of the table', () => {
  it('birthdayOnly keeps the people with a birthday in the next 30 days', () => {
    const people = [p('A', '--11-20'), p('B', '--03-01'), p('C')]
    const rows = completeRows({ s: { people }, tags: [], now: TODAY.getTime() }, { query: '', overdueOnly: false, birthdayOnly: true })
    expect(rows.map((r) => r.id)).toEqual(['A'])
  })
})
