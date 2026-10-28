// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar "I'm here now" (wave 24, cal4): pure state, who is here and what was shared, the bell diff, the draft tag, the event kind. */
import { eventForDraft } from '../../src/record_origin.ts'
import { arrive, hereNow, isOnNow, leave, newSince, setBell } from '../../src/ext/calendar/at_event.ts'
import { ALL_KINDS_ON, NOTIFY_KINDS, kindsOf, workerLines } from '../../src/notify_kinds.ts'
import { bundleOf } from '../../src/sync_core.ts'

const local = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const NOW = local(2026, 11, 2, 14, 30)
const SINCE = local(2026, 11, 2, 14, 5)
const ev = (extra = {}) => ({ id: 'e1', name: 'Fair', from: '2026-11-02T10:00', to: '2026-11-02T18:00', where: 'Graz', createdAt: 0, attended: true, ...extra })
const msg = (peer, text, at, dir = 'in') => ({ key: `${dir}:${at}:${text}`, dir, text, at, sentAt: at, state: 'received' })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], events: [ev()], ...over })

describe('isOnNow', () => {
  it('true on the event day (date range), false before and after', () => {
    expect(isOnNow(ev(), NOW)).toBe(true)
    expect(isOnNow(ev({ from: '2026-11-01', to: '2026-11-03' }), NOW)).toBe(true)
    expect(isOnNow(ev({ from: '2026-11-03', to: undefined }), NOW)).toBe(false)
    expect(isOnNow(ev({ from: '2026-11-01', to: undefined }), NOW)).toBe(false)
  })
})

describe('arrive / leave', () => {
  it('sets atEvent, replaces another event, bell absent = on', () => {
    const s = state({ events: [ev(), ev({ id: 'e2' })] })
    arrive(s, 'e1', SINCE)
    expect(s.atEvent).toEqual({ eventId: 'e1', since: SINCE })
    arrive(s, 'e2', NOW)
    expect(s.atEvent).toEqual({ eventId: 'e2', since: NOW })
  })
  it('ignores an unknown event; leave clears', () => {
    const s = state()
    arrive(s, 'nope', NOW)
    expect(s.atEvent).toBeUndefined()
    arrive(s, 'e1', NOW); leave(s)
    expect(s.atEvent).toBeUndefined()
  })
  it('setBell stores false only; on removes the key', () => {
    const s = state()
    arrive(s, 'e1', NOW)
    setBell(s, false); expect(s.atEvent.bell).toBe(false)
    setBell(s, true); expect('bell' in s.atEvent).toBe(false)
  })
  it('does not travel in the sync bundle', () => {
    const s = state()
    arrive(s, 'e1', NOW)
    expect(JSON.stringify(bundleOf(s, {}))).not.toContain('atEvent')
  })
})

describe('hereNow', () => {
  it('null when not at an event, or when the event is gone', () => {
    expect(hereNow(state(), NOW)).toBeNull()
    expect(hereNow(state({ atEvent: { eventId: 'x', since: SINCE } }), NOW)).toBeNull()
  })
  it('null once the event ended more than 6 h ago', () => {
    const s = state({ atEvent: { eventId: 'e1', since: SINCE } })
    expect(hereNow(s, local(2026, 11, 3, 0, 5))).toBeNull()
    expect(hereNow(s, local(2026, 11, 2, 23, 0))).not.toBeNull()
  })
  it('people = invitees + attendees once, new only when met since', () => {
    const s = state({
      atEvent: { eventId: 'e1', since: SINCE },
      events: [ev({ people: ['a', 'b'] })],
      people: [
        { id: 'a', name: 'A', metAt: SINCE - 1000, events: ['e1'] },
        { id: 'b', name: 'B', metAt: SINCE + 1000 },
        { id: 'c', name: 'C', metAt: SINCE + 5, events: ['e1'] },
        { id: 'd', name: 'D', metAt: SINCE + 5 },
      ],
    })
    const h = hereNow(s, NOW)
    expect(h.event.id).toBe('e1')
    expect(h.people.map((x) => [x.person.id, x.isNew])).toEqual([['a', false], ['b', true], ['c', true]])
  })
  it('shared = chat from those people, tagged lines and items since arrival, newest first, max 30', () => {
    const s = state({
      atEvent: { eventId: 'e1', since: SINCE },
      events: [ev({ people: ['a'] })],
      people: [
        { id: 'a', name: 'A', metAt: 0, peerId: 'pa', lines: [
          { id: 'l1', text: 'old line', notedAt: SINCE - 1, eventId: 'e1' },
          { id: 'l2', text: 'line here', notedAt: SINCE + 20, eventId: 'e1' },
          { id: 'l3', text: 'other event', notedAt: SINCE + 30, eventId: 'e9' },
        ] },
        { id: 'z', name: 'Z', metAt: 0, peerId: 'pz' },
      ],
      inventory: [{ id: 'i1', text: 'wheels', createdAt: SINCE + 40, eventId: 'e1' }, { id: 'i2', text: 'plain', createdAt: SINCE + 50 }],
      chats: { pa: { unread: 0, messages: [msg('pa', 'hello', SINCE + 10), msg('pa', 'before', SINCE - 5), msg('pa', 'mine', SINCE + 60, 'out')] }, pz: { unread: 0, messages: [msg('pz', 'stranger', SINCE + 70)] } },
    })
    const sh = hereNow(s, NOW).shared
    expect(sh.map((x) => [x.kind, x.text])).toEqual([['item', 'wheels'], ['line', 'line here'], ['chat', 'hello']])
    expect(sh[1].personId).toBe('a')
    const many = state({ atEvent: { eventId: 'e1', since: SINCE }, events: [ev({ people: ['a'] })], people: [{ id: 'a', name: 'A', metAt: 0, peerId: 'pa' }],
      chats: { pa: { unread: 0, messages: Array.from({ length: 40 }, (_, i) => msg('pa', `m${i}`, SINCE + i)) } } })
    expect(hereNow(many, NOW).shared).toHaveLength(30)
  })
})

describe('newSince', () => {
  const h = (people, shared) => ({ event: ev(), people: people.map((id) => ({ person: { id, name: id.toUpperCase() }, isNew: true })), shared })
  const sh = (text, at) => ({ kind: 'chat', text, at, personId: 'a' })
  it('lists people and shares that the next state has and the previous lacks', () => {
    const d = newSince(h(['a'], [sh('x', 1)]), h(['a', 'b'], [sh('x', 1), sh('y', 2)]))
    expect(d.people.map((p) => p.id)).toEqual(['b'])
    expect(d.shared.map((x) => x.text)).toEqual(['y'])
  })
  it('nothing without a previous state or when nothing changed', () => {
    expect(newSince(null, h(['a'], []))).toEqual({ people: [], shared: [] })
    expect(newSince(h(['a'], []), h(['a'], []))).toEqual({ people: [], shared: [] })
    expect(newSince(h(['a'], []), null)).toEqual({ people: [], shared: [] })
  })
})

describe('eventForDraft', () => {
  it('the event id while at a known event, else undefined', () => {
    expect(eventForDraft(state())).toBeUndefined()
    expect(eventForDraft(state({ atEvent: { eventId: 'e1', since: 1 } }))).toBe('e1')
    expect(eventForDraft(state({ atEvent: { eventId: 'gone', since: 1 } }))).toBeUndefined()
  })
})

describe('notify kind event', () => {
  it('default on, listed, never a waiting-wire line', () => {
    expect(ALL_KINDS_ON.event).toBe(true)
    expect(NOTIFY_KINDS).toContain('event')
    expect(kindsOf({ notifyKinds: { connect: true, ask: true, chat: true, reminder: true } }).event).toBe(true)
    expect(workerLines([{ kind: 'event', name: null }], ALL_KINDS_ON)).toEqual([])
  })
})
