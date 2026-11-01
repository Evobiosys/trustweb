// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b: close ties expire after n days without contact (engagement.ts). */
import { ChatDirection } from '../../src/chat.ts'
import { Ring } from '../../src/model.ts'
import { DAY_MS, engagementDays, lastContact, noticeDue, parseDays, releaseTies, undoRelease, expiringSoon, ensureBaseline, inScope, openReleases, dismissReleases, undoAllReleases, undoOffered, UNDO_DAYS, soonNames } from '../../src/engagement.ts'

const NOW = Date.UTC(2026, 9, 28, 12, 0)
const person = (o = {}) => ({ id: 'p1', name: 'Anna', context: '', ring: Ring.Close, metAt: 0, peerId: 'pe1', ...o })
// Expiry is off by default (wave 25): these tests switch it on.
const state = (o = {}) => ({ people: [person()], engagementDays: 30, ...o })

describe('engagement window', () => {
  it('absent = off (0); a stored number of days switches it on; junk is off', () => {
    expect(engagementDays({})).toBe(0)
    expect(engagementDays({ engagementDays: 0 })).toBe(0)
    expect(engagementDays({ engagementDays: 14 })).toBe(14)
    expect(engagementDays({ engagementDays: -3 })).toBe(0)
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

describe('baseline at the first run', () => {
  const old = (days) => NOW - days * DAY_MS
  it('stores engagementSince once and never moves it', () => {
    const s = state()
    ensureBaseline(s, NOW)
    expect(s.engagementSince).toBe(NOW)
    ensureBaseline(s, NOW + 5)
    expect(s.engagementSince).toBe(NOW)
  })
  it('lastContact is at least engagementSince, so nobody is released for 30 days', () => {
    const s = state({ engagementSince: NOW, people: [person({ metAt: old(400) })] })
    expect(lastContact(s, s.people[0], NOW)).toBe(NOW)
    expect(releaseTies(s, NOW + 29 * DAY_MS)).toEqual([])
    expect(expiringSoon(s, NOW + 5 * DAY_MS)).toEqual([])
    expect(expiringSoon(s, NOW + 29 * DAY_MS + 1).map((p) => p.id)).toEqual(['p1'])
    expect(releaseTies(s, NOW + 31 * DAY_MS)).toHaveLength(1)
  })
  it('real contact after the baseline still wins', () => {
    const s = state({ engagementSince: NOW - DAY_MS, people: [person({ metAt: NOW })] })
    expect(lastContact(s, s.people[0], NOW)).toBe(NOW)
  })
})

describe('scope', () => {
  const old = NOW - 90 * DAY_MS
  it('notes-only cards are subject to nothing', () => {
    const s = state({ people: [person({ peerId: undefined, metAt: old })] })
    expect(inScope(s, s.people[0])).toBe(false)
    expect(releaseTies(s, NOW)).toEqual([])
    expect(expiringSoon(s, NOW)).toEqual([])
  })
  it('connected, channel value, chat thread or meeting puts a person in scope', () => {
    const bare = { peerId: undefined }
    expect(inScope(state(), person())).toBe(true)
    expect(inScope(state(), person({ ...bare, channels: { email: 'a@b.c' } }))).toBe(true)
    expect(inScope(state(), person({ ...bare, channels: { email: '' } }))).toBe(false)
    expect(inScope(state({ meetings: [{ personId: 'p1', startedAt: 1 }] }), person(bare))).toBe(true)
    expect(inScope(state({ chats: { pe9: { unread: 0, messages: [{ dir: ChatDirection.In, at: 1 }] } } }), person({ peerId: 'pe9' }))).toBe(true)
  })
})

describe('one summary card and per-person undo', () => {
  const old = (days) => NOW - days * DAY_MS
  const released = () => {
    const s = state({ people: [person({ metAt: old(40) }), person({ id: 'p2', name: 'Ben', metAt: old(40) })] })
    releaseTies(s, NOW)
    return s
  }
  it('open releases are the not-dismissed ones; dismiss keeps the record for the ring row undo', () => {
    const s = released()
    expect(openReleases(s, NOW)).toHaveLength(2)
    dismissReleases(s)
    expect(openReleases(s, NOW)).toEqual([])
    expect(undoOffered(s, 'p1', NOW + DAY_MS)).toBe(true)
  })
  it('undo offered for 7 days only, and not for others', () => {
    const s = released()
    expect(undoOffered(s, 'p1', NOW + (UNDO_DAYS - 1) * DAY_MS)).toBe(true)
    expect(undoOffered(s, 'p1', NOW + UNDO_DAYS * DAY_MS)).toBe(false)
    expect(undoOffered(s, 'zz', NOW)).toBe(false)
    expect(openReleases(s, NOW + UNDO_DAYS * DAY_MS)).toEqual([])
  })
  it('undo all restores every open release; undo of one leaves the rest', () => {
    const s = released()
    undoRelease(s, 'p1', NOW)
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Close, Ring.Friend])
    expect(openReleases(s, NOW).map((r) => r.personId)).toEqual(['p2'])
    undoAllReleases(s, NOW)
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Close, Ring.Close])
    expect(s.releasedTies).toEqual([])
  })
  it('a later release of the same person replaces its old record', () => {
    const s = released()
    undoRelease(s, 'p1', NOW)
    s.people[0].engagementKept = NOW - 40 * DAY_MS
    releaseTies(s, NOW + DAY_MS)
    expect(s.releasedTies.filter((r) => r.personId === 'p1')).toHaveLength(1)
  })
})

describe('the 48 h notice names', () => {
  it('up to three names, then the count', () => {
    const ps = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }))
    expect(soonNames(ps.slice(0, 2))).toEqual({ names: ['A', 'B'], more: 0 })
    expect(soonNames(ps)).toEqual({ names: ['A', 'B', 'C'], more: 2 })
  })
})

describe('the Released card in the stack', () => {
  it('ONE summary card for all open releases, keyed by the newest', async () => {
    const { StackCardKind, stackCards } = await import('../../src/card_stack.ts')
    const r = (personId, at) => ({ personId, name: personId, from: Ring.Close, to: Ring.Friend, at })
    const ties = [r('p1', NOW - 5), r('p2', NOW - 1)]
    const cards = stackCards({ releasedTies: ties }, NOW, false, new Set(), () => true)
    expect(cards).toEqual([{ kind: StackCardKind.Released, key: `released:${NOW - 1}:2`, ties }])
    expect(stackCards({ releasedTies: [{ ...ties[0], seen: true }] }, NOW, false, new Set(), () => true)).toEqual([])
  })
})
