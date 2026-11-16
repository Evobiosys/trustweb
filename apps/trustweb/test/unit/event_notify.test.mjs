// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c shell-fix-2 (43-D3): the per-event Notifications switch governs invitations, feed posts and support asks, and the bell entries of that event. */
import { eventNotifies, sourceNotifies } from '../../src/event_notify.ts'
import { notifyOn } from '../../src/events.ts'
import { centerItems, unreadCount } from '../../src/notify_center.ts'
import { popupRows } from '../../src/notify_inbox.ts'

const NOW = Date.UTC(2026, 10, 16, 12)
const ev = (id, name, over = {}) => ({ id, name, from: '2026-11-16', createdAt: 1, ...over })
const state = (over = {}) => ({
  people: [
    { id: 'pa', name: 'Ada', peerId: 'qa', events: ['off'] },
    { id: 'pb', name: 'Bob', peerId: 'qb', events: ['off', 'on'] },
    { id: 'pc', name: 'Cleo', peerId: 'qc' },
  ],
  events: [ev('off', 'Quiet Forum', { notify: false }), ev('on', 'Loud Forum')],
  ...over,
})

describe('eventNotifies (the one predicate)', () => {
  it('is on unless the event says false; notifyOn is the same function', () => {
    expect(eventNotifies(ev('x', 'X'))).toBe(true)
    expect(eventNotifies(ev('x', 'X', { notify: true }))).toBe(true)
    expect(eventNotifies(ev('x', 'X', { notify: false }))).toBe(false)
    expect(notifyOn).toBe(eventNotifies)
  })
})

describe('sourceNotifies per source', () => {
  it('invitation: matched to its event by name (case-insensitive) or tag name; unknown event keeps notifying', () => {
    expect(sourceNotifies(state(), { kind: 'invitation', event: 'quiet forum' })).toBe(false)
    expect(sourceNotifies(state(), { kind: 'invitation', event: 'Loud Forum' })).toBe(true)
    expect(sourceNotifies(state(), { kind: 'invitation', event: 'Somewhere else' })).toBe(true)
    expect(sourceNotifies(state(), { kind: 'invitation' })).toBe(true)
    expect(sourceNotifies(state({ events: [ev('t', 'Long Name', { tagName: 'Short', notify: false })] }), { kind: 'invitation', event: 'short' })).toBe(false)
  })
  it('feed post: by event id or relay group event:<id>', () => {
    expect(sourceNotifies(state(), { kind: 'feed', eventId: 'off' })).toBe(false)
    expect(sourceNotifies(state(), { kind: 'feed', group: 'event:off' })).toBe(false)
    expect(sourceNotifies(state(), { kind: 'feed', group: 'event:on' })).toBe(true)
    expect(sourceNotifies(state(), { kind: 'feed', group: 'community-7' })).toBe(true)
  })
  it('support ask: quiet only when every event the sender is tagged with is off', () => {
    expect(sourceNotifies(state(), { kind: 'support', peerId: 'qa' })).toBe(false)
    expect(sourceNotifies(state(), { kind: 'support', peerId: 'qb' })).toBe(true)
    expect(sourceNotifies(state(), { kind: 'support', peerId: 'qc' })).toBe(true)
    expect(sourceNotifies(state(), { kind: 'support', peerId: 'nobody' })).toBe(true)
  })
})

describe('the bell and the popup', () => {
  const inbox = [
    { id: 'i1', kind: 'event', title: 'T', body: 'invited', at: NOW - 1, seenAt: null, eventId: 'off' },
    { id: 'i2', kind: 'event', title: 'T', body: 'post', at: NOW - 2, seenAt: null, eventId: 'on' },
    { id: 'i3', kind: 'event', title: 'T', body: 'no event', at: NOW - 3, seenAt: null },
  ]
  it('bell entries of a quiet event are left out of the list and the count', () => {
    const s = state({ notifInbox: inbox })
    expect(centerItems(s, NOW).map((i) => i.id)).toEqual(['inbox:i2', 'inbox:i3'])
    expect(unreadCount(s, NOW)).toBe(2)
  })
  it('switching the event back on brings them back', () => {
    const s = state({ notifInbox: inbox })
    s.events[0].notify = true
    expect(unreadCount(s, NOW)).toBe(3)
  })
  it('the missed-notifications popup skips them too', () => {
    const s = state({ notifInbox: inbox })
    expect(popupRows(inbox, false, s.events).map((r) => r.id)).toEqual(['i2', 'i3'])
  })
})
