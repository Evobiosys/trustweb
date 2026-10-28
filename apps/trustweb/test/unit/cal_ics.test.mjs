// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar .ics (wave 24, cal6): small RFC 5545 subset, written and read by hand; an .ics never carries invitees (I1). */
import { toIcs, fromIcs, importIcs } from '../../src/ext/calendar/ics.ts'

const NOW = Date.UTC(2026, 9, 28, 8, 5, 9)
const ev = (id, extra = {}) => ({ id, name: id, from: '2026-11-02', where: '', createdAt: 1, attended: true, ...extra })
const state = (events = []) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], events })
const lines = (s) => s.split('\r\n')
const p2 = (n) => String(n).padStart(2, '0')
const localOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` }

describe('toIcs', () => {
  it('writes a calendar with CRLF, stamp, uid and the all-day end as the exclusive next day', () => {
    const out = toIcs([ev('a', { name: 'Fair', to: '2026-11-04' })], [], NOW)
    expect(out.endsWith('\r\n')).toBe(true)
    const l = lines(out)
    expect(l.slice(0, 5)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TrustWeb//Calendar//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'])
    expect(l).toContain('UID:a@trustweb')
    expect(l).toContain('DTSTAMP:20261028T080509Z')
    expect(l).toContain('DTSTART;VALUE=DATE:20261102')
    expect(l).toContain('DTEND;VALUE=DATE:20261105')
    expect(l).toContain('SUMMARY:Fair')
  })
  it('single all-day event ends the next day; month ends roll over', () => {
    expect(lines(toIcs([ev('a', { from: '2026-12-31' })], [], NOW))).toContain('DTEND;VALUE=DATE:20270101')
  })
  it('timed events are floating local time; place and notes only when present', () => {
    const l = lines(toIcs([ev('a', { from: '2026-10-28T14:00', to: '2026-10-28T15:30', where: 'Graz', conditions: 'Bring ID' })], [], NOW))
    expect(l).toContain('DTSTART:20261028T140000')
    expect(l).toContain('DTEND:20261028T153000')
    expect(l).toContain('LOCATION:Graz')
    expect(l).toContain('DESCRIPTION:Bring ID')
    expect(lines(toIcs([ev('b')], [], NOW)).some((x) => x.startsWith('LOCATION') || x.startsWith('DESCRIPTION'))).toBe(false)
  })
  it('escapes , ; \\ and newlines and folds at 75 octets without splitting a character', () => {
    const out = toIcs([ev('a', { name: 'a,b;c\\d', conditions: 'x\ny' + 'ä'.repeat(80) })], [], NOW)
    expect(out).toContain('SUMMARY:a\\,b\\;c\\\\d')
    expect(out).toContain('DESCRIPTION:x\\ny')
    for (const l of lines(out)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(fromIcs(out).events[0].conditions).toBe('x\ny' + 'ä'.repeat(80))
  })
  it('tasks: only those with a due; done, repeat; never people, tags or list', () => {
    const t = (id, extra = {}) => ({ id, title: id, stamp: 1, ...extra })
    const l = lines(toIcs([], [t('n'), t('a', { due: '2026-11-02', people: ['p1'], tags: ['secret'], list: 'L' }), t('b', { due: '2026-11-03T09:30', done: NOW, repeat: 'weekly' })], NOW))
    expect(l.filter((x) => x === 'BEGIN:VTODO')).toHaveLength(2)
    expect(l).toContain('UID:a@trustweb')
    expect(l).toContain('DUE;VALUE=DATE:20261102')
    expect(l).toContain('DUE:20261103T093000')
    expect(l).toContain('STATUS:COMPLETED')
    expect(l).toContain('COMPLETED:20261028T080509Z')
    expect(l).toContain('RRULE:FREQ=WEEKLY')
    expect(l.join()).not.toMatch(/p1|secret|ATTENDEE/)
  })
  it('never writes invitees', () => {
    const out = toIcs([ev('a', { people: ['p1'], organizer: 'Org', hosts: ['H'] })], [], NOW)
    expect(out).not.toMatch(/p1|ATTENDEE|ORGANIZER/)
  })
})

describe('fromIcs', () => {
  it('round-trips names, dates, places', () => {
    const src = [ev('a', { name: 'Fair', from: '2026-11-02', to: '2026-11-04', where: 'Graz' }), ev('b', { from: '2026-10-28T14:00', to: '2026-10-28T15:30', name: 'Call, now' })]
    const r = fromIcs(toIcs(src, [], NOW))
    expect(r.skipped).toBe(0)
    expect(r.events).toEqual([
      { uid: 'a@trustweb', name: 'Fair', from: '2026-11-02', to: '2026-11-04', where: 'Graz' },
      { uid: 'b@trustweb', name: 'Call, now', from: '2026-10-28T14:00', to: '2026-10-28T15:30', where: '' },
    ])
  })
  const GOOGLE = [
    'BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Vienna', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'DTSTART:20261103T090000Z', 'DTEND:20261103T100000Z', 'UID:g1@google.com', 'SUMMARY:Standup', 'LOCATION:Room 1\\, 2nd floor', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;TZID=Europe/Vienna:20261104T180000', 'DTEND;TZID=Europe/Vienna:20261104T193000', 'UID:g2@google.com', 'SUMMARY:Dinner',
    'DESCRIPTION:A very long description that google folds somewhere in the mid', ' dle of a word and goes on', '\tand on.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261113', 'UID:g3@google.com', 'SUMMARY:Retreat', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261121', 'UID:g4@google.com', 'SUMMARY:One day', 'END:VEVENT',
    'BEGIN:VTODO', 'UID:t1', 'SUMMARY:A task', 'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n')
  it('reads a Google-style file: UTC to local, TZID as wall time, folds, all-day multi-day, VALARM ignored, VTODO skipped', () => {
    const r = fromIcs(GOOGLE)
    expect(r.skipped).toBe(1)
    expect(r.events).toEqual([
      { uid: 'g1@google.com', name: 'Standup', from: localOf(Date.UTC(2026, 10, 3, 9)), to: localOf(Date.UTC(2026, 10, 3, 10)), where: 'Room 1, 2nd floor' },
      { uid: 'g2@google.com', name: 'Dinner', from: '2026-11-04T18:00', to: '2026-11-04T19:30', where: '', conditions: 'A very long description that google folds somewhere in the middle of a word and goes onand on.' },
      { uid: 'g3@google.com', name: 'Retreat', from: '2026-11-10', to: '2026-11-12', where: '' },
      { uid: 'g4@google.com', name: 'One day', from: '2026-11-20', where: '' },
    ])
  })
  it('accepts bare LF; counts events without a start or a uid-less one still imports', () => {
    const r = fromIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261101\nSUMMARY:y\nEND:VEVENT\nEND:VCALENDAR')
    expect(r.skipped).toBe(1)
    expect(r.events).toMatchObject([{ name: 'y', from: '2026-11-01', where: '' }])
  })
  it('caps at 2000 events and 2 MB', () => {
    const one = 'BEGIN:VEVENT\r\nDTSTART:20261101\r\nSUMMARY:x\r\nEND:VEVENT\r\n'
    const r = fromIcs('BEGIN:VCALENDAR\r\n' + one.repeat(2005) + 'END:VCALENDAR')
    expect(r.events).toHaveLength(2000)
    expect(r.skipped).toBe(5)
    const big = fromIcs('BEGIN:VCALENDAR\r\n' + 'X-PAD:' + 'a'.repeat(2_100_000) + '\r\n' + one + 'END:VCALENDAR')
    expect(big.events).toHaveLength(0)
    expect(big.skipped).toBeGreaterThan(0)
  })
})

describe('importIcs', () => {
  const parsed = (...events) => ({ events, skipped: 0 })
  const idGen = () => { let n = 0; return () => `n${++n}` }
  it('adds events with their uid; a repeat import updates instead of duplicating', () => {
    const s = state()
    const f = { uid: 'g1@google.com', name: 'Standup', from: '2026-11-03T09:00', where: 'R1' }
    expect(importIcs(s, parsed(f), idGen(), NOW)).toEqual({ added: 1, updated: 0 })
    expect(s.events[0]).toMatchObject({ id: 'n1', name: 'Standup', icsUid: 'g1@google.com', attended: true, createdAt: NOW })
    expect(importIcs(s, parsed({ ...f, name: 'Standup 2', where: '' }), idGen(), NOW)).toEqual({ added: 0, updated: 1 })
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({ id: 'n1', name: 'Standup 2', where: '' })
  })
  it('an event I exported (<id>@trustweb) is updated in place and keeps its invitees; dropped to/notes are cleared', () => {
    const s = state([ev('a', { name: 'Old', to: '2026-11-04', conditions: 'x', people: ['p1'] })])
    expect(importIcs(s, parsed({ uid: 'a@trustweb', name: 'New', from: '2026-11-02', where: 'Wien' }), idGen(), NOW)).toEqual({ added: 0, updated: 1 })
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({ id: 'a', name: 'New', where: 'Wien', people: ['p1'], createdAt: 1 })
    expect(s.events[0].to).toBeUndefined()
    expect(s.events[0].conditions).toBeUndefined()
  })
  it('the same uid twice in one file adds once; an invalid event (end before start) is not added', () => {
    const s = state()
    const f = { uid: 'u', name: 'x', from: '2026-11-03', where: '' }
    expect(importIcs(s, parsed(f, f, { uid: 'v', name: 'bad', from: '2026-11-03', to: '2026-11-01', where: '' }), idGen(), NOW)).toEqual({ added: 1, updated: 1 })
    expect(s.events).toHaveLength(1)
  })
})
