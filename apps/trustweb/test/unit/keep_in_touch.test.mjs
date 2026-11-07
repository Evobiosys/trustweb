// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { overduePeople, goneQuiet, noticeText, keepNoticeDue } from '../../src/keep_in_touch.ts'

const DAY = 86_400_000
const NOW = 5000 * DAY
const p = (id, o = {}) => ({ id, name: id, ring: 'friend', metAt: NOW - 400 * DAY, context: '', lines: [], ...o })
const st = (...people) => ({ people })

describe('overduePeople', () => {
  it('needs a cadence; off is never overdue', () => {
    expect(overduePeople(st(p('a')), NOW)).toEqual([])
  })
  it('is overdue exactly at the reminder day, not the day before', () => {
    const late = p('a', { cadenceDays: 30, engagementKept: NOW - 30 * DAY })
    const early = p('b', { cadenceDays: 30, engagementKept: NOW - 30 * DAY + 1 })
    expect(overduePeople(st(late, early), NOW).map((x) => x.id)).toEqual(['a'])
  })
  it('"I was in touch today" clears it', () => {
    const a = p('a', { cadenceDays: 7, metAt: NOW - 100 * DAY })
    expect(overduePeople(st(a), NOW)).toHaveLength(1)
    a.engagementKept = NOW
    expect(overduePeople(st(a), NOW)).toEqual([])
  })
  it('leaves out deleted and archived people', () => {
    const base = { cadenceDays: 7, metAt: NOW - 100 * DAY }
    const s = st(p('a', base), p('d', { ...base, deleted_at: new Date(NOW).toISOString(), ring: 'none' }), p('x', { ...base, ring: 'none' }))
    expect(overduePeople(s, NOW).map((x) => x.id)).toEqual(['a'])
  })
  it('lists the longest overdue first', () => {
    const s = st(p('a', { cadenceDays: 7, metAt: NOW - 20 * DAY }), p('b', { cadenceDays: 7, metAt: NOW - 90 * DAY }))
    expect(overduePeople(s, NOW).map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('goneQuiet', () => {
  it('without a cadence: more than 90 days', () => {
    const s = st(p('a', { metAt: NOW - 90 * DAY }), p('b', { metAt: NOW - 91 * DAY }))
    expect(goneQuiet(s, NOW).map((x) => x.id)).toEqual(['b'])
  })
  it('with a cadence: more than twice the cadence', () => {
    const s = st(p('a', { cadenceDays: 14, metAt: NOW - 28 * DAY }), p('b', { cadenceDays: 14, metAt: NOW - 29 * DAY }), p('c', { cadenceDays: 365, metAt: NOW - 200 * DAY }))
    expect(goneQuiet(s, NOW).map((x) => x.id)).toEqual(['b'])
  })
  it('only Closest, Close and Friend', () => {
    const s = st(p('a', { ring: 'closest' }), p('b', { ring: 'close' }), p('c', { ring: 'friend' }), p('d', { ring: 'acquaintance' }), p('e', { ring: 'unsorted' }), p('f', { ring: 'none' }))
    expect(goneQuiet(s, NOW).map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('leaves out deleted people', () => {
    expect(goneQuiet(st(p('a', { deleted_at: new Date(NOW).toISOString() })), NOW)).toEqual([])
  })
})

describe('noticeText', () => {
  it('names up to three, then counts', () => {
    expect(noticeText(['Anna'])).toBe('Time to get in touch: Anna')
    expect(noticeText(['Anna', 'Ben'])).toBe('Time to get in touch: Anna and Ben')
    expect(noticeText(['Anna', 'Ben', 'Cy'])).toBe('Time to get in touch: Anna, Ben and Cy')
    expect(noticeText(['Anna', 'Ben', 'Cy', 'Di', 'Ed'])).toBe('Time to get in touch: Anna, Ben, Cy and 2 more')
  })
})

describe('keepNoticeDue', () => {
  const at = (h) => new Date(2026, 10, 7, h, 0)
  it('once a day, from midday', () => {
    expect(keepNoticeDue({}, at(11))).toBe(false)
    expect(keepNoticeDue({}, at(12))).toBe(true)
    expect(keepNoticeDue({ keepNoticeDay: '2026-11-07' }, at(15))).toBe(false)
    expect(keepNoticeDue({ keepNoticeDay: '2026-11-06' }, at(15))).toBe(true)
  })
})
