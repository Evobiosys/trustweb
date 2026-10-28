// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b: close ties expire after n days without contact (engagement.ts). */
import { ChatDirection } from '../../src/chat.ts'
import { Ring } from '../../src/model.ts'
import { DAY_MS, engagementDays, lastContact, noticeDue, parseDays, releaseTies, undoRelease, expiringSoon } from '../../src/engagement.ts'

const NOW = Date.UTC(2026, 9, 28, 12, 0)
const person = (o = {}) => ({ id: 'p1', name: 'Anna', context: '', ring: Ring.Close, metAt: 0, peerId: 'pe1', ...o })
const state = (o = {}) => ({ people: [person()], ...o })

describe('engagement window', () => {
  it('absent = 30 days; 0 = off; junk falls back', () => {
    expect(engagementDays({})).toBe(30)
    expect(engagementDays({ engagementDays: 0 })).toBe(0)
    expect(engagementDays({ engagementDays: 14 })).toBe(14)
    expect(engagementDays({ engagementDays: -3 })).toBe(30)
  })
  it('parses the settings field: empty keeps, 0 off, clamped 1..365, whole days', () => {
    expect(parseDays('')).toBeNull()
    expect(parseDays('abc')).toBeNull()
    expect(parseDays('0')).toBe(0)
    expect(parseDays('7.6')).toBe(8)
    expect(parseDays('9999')).toBe(365)
  })
})

describe('lastContact', () => {
  it('is the newest of chat, timeline, meeting, event, metAt', () => {
    const s = state({
      chats: { pe1: { unread: 0, messages: [{ dir: ChatDirection.In, at: 100 }, { dir: ChatDirection.Out, at: 300 }] } },
      meetings: [{ personId: 'p1', startedAt: 200, endedAt: 250 }, { personId: 'other', startedAt: 900, endedAt: 950 }],
      events: [{ id: 'e1', from: '1970-01-01', people: ['p1'] }],
    })
    s.people[0].timeline = [{ at: 400 }]
    s.people[0].metAt = 50
    expect(lastContact(s, s.people[0], NOW)).toBe(400)
  })
  it('counts event co-attendance by the event start, never a future event', () => {
    const past = Date.UTC(2026, 9, 1)
    const s = state({ events: [{ id: 'e1', from: '2026-10-01', people: ['p1'] }, { id: 'e2', from: '2026-12-01', people: ['p1'] }] })
    expect(lastContact(s, s.people[0], NOW)).toBe(past)
    const t = state({ events: [{ id: 'e1', from: '2026-10-02T10:00' }] })
    t.people[0].events = ['e1']
    expect(lastContact(t, t.people[0], NOW)).toBe(new Date('2026-10-02T10:00').getTime())
  })
  it('a kept tie (undo) counts as contact', () => {
    const s = state()
    s.people[0].engagementKept = 777
    expect(lastContact(s, s.people[0], NOW)).toBe(777)
  })
})

describe('release and warning', () => {
  const old = (days) => NOW - days * DAY_MS
  it('releases Close to Friend and Friend to Acquaintance after the window; others stay', () => {
    const s = state({ people: [person({ metAt: old(31) }), person({ id: 'p2', ring: Ring.Friend, metAt: old(40) }), person({ id: 'p3', ring: Ring.Acquaintance, metAt: old(99) }), person({ id: 'p4', metAt: old(5) })] })
    const out = releaseTies(s, NOW)
    expect(out.map((r) => [r.personId, r.from, r.to])).toEqual([['p1', Ring.Close, Ring.Friend], ['p2', Ring.Friend, Ring.Acquaintance]])
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Friend, Ring.Acquaintance, Ring.Acquaintance, Ring.Close])
    expect(s.releasedTies).toHaveLength(2)
    expect(s.releasedTies[0]).toMatchObject({ personId: 'p1', name: 'Anna', from: Ring.Close, to: Ring.Friend, at: NOW })
  })
  it('off (0) releases nobody and warns nobody', () => {
    const s = state({ engagementDays: 0, people: [person({ metAt: old(500) })] })
    expect(releaseTies(s, NOW)).toEqual([])
    expect(expiringSoon(s, NOW)).toEqual([])
  })
  it('a person with no contact on record at all is not released (nothing to measure from)', () => {
    const s = state({ people: [person({ metAt: 0 })] })
    expect(releaseTies(s, NOW)).toEqual([])
  })
  it('warns when the window ends within 48 h, not before, not after', () => {
    const s = state({ people: [person({ metAt: old(29) }), person({ id: 'p2', metAt: old(27) }), person({ id: 'p3', metAt: old(31) })] })
    expect(expiringSoon(s, NOW).map((p) => p.id)).toEqual(['p1'])
  })
  it('undo moves the ring back, keeps the tie and drops the card', () => {
    const s = state({ people: [person({ metAt: old(40) })] })
    releaseTies(s, NOW)
    undoRelease(s, 'p1', NOW)
    expect(s.people[0].ring).toBe(Ring.Close)
    expect(s.releasedTies).toEqual([])
    expect(releaseTies(s, NOW)).toEqual([])
  })
})

describe('the daily notice', () => {
  const at = (h, d = 28) => new Date(2026, 9, d, h, 0)
  it('due at the first open after 12:00 local, once a day', () => {
    expect(noticeDue({}, at(11))).toBe(false)
    expect(noticeDue({}, at(12))).toBe(true)
    expect(noticeDue({ engagementNoticeDay: '2026-10-28' }, at(15))).toBe(false)
    expect(noticeDue({ engagementNoticeDay: '2026-10-27' }, at(15))).toBe(true)
  })
})

describe('the Released card in the stack', () => {
  it('one card per released tie, keyed by person and time', async () => {
    const { StackCardKind, stackCards } = await import('../../src/card_stack.ts')
    const r = { personId: 'p1', name: 'Anna', from: Ring.Close, to: Ring.Friend, at: 5 }
    const cards = stackCards({ releasedTies: [r] }, NOW, false, new Set(), () => true)
    expect(cards).toEqual([{ kind: StackCardKind.Released, key: 'released:p1:5', tie: r }])
  })
})
