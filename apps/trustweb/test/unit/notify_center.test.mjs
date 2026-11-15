// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b notify-center: the bell's sections, the unread count, "Newly added" in the chat list, the "wants to connect" ring, and the halo rules (B16). */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NEWLY_ADDED_DAYS, SECTIONS, centerItems, listNotifications, markAllRead, newlyAdded, unreadCount, wantsConnect } from '../../src/notify_center.ts'
import { haloOf, resolveBar, setBarOrder, showViewInBar, toggleBar, toggleHalo, addBar } from '../../src/bottom_bar.ts'
import { webSlot } from '../../src/rings_layout.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 15, 12)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })
const peer = (id, ago) => ({ id, displayName: id, did: id, ring: 'friend', connectedAt: NOW - ago })
const state = (over = {}) => ({
  people: [P('a', 'Ada', { peerId: 'pa' }), P('b', 'Bob', { peerId: 'pb' }), P('c', 'Cleo', { peerId: 'pc' }), P('d', 'Dan', { reachedOut: 'received', ring: 'intending', metAt: NOW - 1000 })],
  peers: [peer('pa', 2 * DAY), peer('pb', 9 * DAY), peer('pc', NEWLY_ADDED_DAYS * DAY)],
  chats: { pb: { unread: 2, messages: [{ at: NOW - 5000, text: 'hello there', mine: false }] } },
  wantsToConnect: [{ peerId: 'pw', name: 'Wanda', at: NOW - 3000 }],
  notifInbox: [{ id: 'i1', kind: 'event', title: 'TrustWeb', body: 'Eve joined Winter IYG', at: NOW - 4000, seenAt: null }, { id: 'i2', kind: 'chat', title: 'TrustWeb', body: 'x', at: NOW - 9000, seenAt: null }],
  ...over,
})

describe('newly added (A1)', () => {
  it('the window is 7 days; the edge counts, older does not; newest first', () => {
    expect(NEWLY_ADDED_DAYS).toBe(7)
    const s = state()
    expect(newlyAdded(s.people, s.peers, NOW).map((r) => r.personId)).toEqual(['a', 'c'])
  })
  it('a person without a peer, or a peer with no person, is not listed', () => {
    expect(newlyAdded([P('x', 'X')], [peer('px', 0)], NOW)).toEqual([])
  })
})

describe('sections', () => {
  it('four sections in this order', () => { expect(SECTIONS).toEqual(['messages', 'wants', 'connected', 'events']) })
  it('each item lands in its section with its action', () => {
    const by = Object.groupBy ? Object.groupBy(centerItems(state(), NOW), (i) => i.section) : null
    const items = centerItems(state(), NOW)
    const of = (sec) => items.filter((i) => i.section === sec)
    expect(of('messages').map((i) => [i.title, i.body, i.action])).toEqual([['Bob', 'hello there', 'open-chat']])
    expect(of('wants').map((i) => [i.title, i.action]).sort()).toEqual([['Dan', 'open-card'], ['Wanda', 'add']])
    expect(of('connected').map((i) => [i.title, i.action])).toEqual([['Ada', 'message'], ['Cleo', 'message']])
    expect(of('events').map((i) => i.body)).toEqual(['Eve joined Winter IYG'])
    void by
  })
  it('a chat notification in the inbox is not an Events row', () => {
    expect(centerItems(state(), NOW).some((i) => i.id === 'inbox:i2')).toBe(false)
  })
  it('wantsConnect: reached out to me, not yet sorted', () => {
    expect(wantsConnect(P('d', 'D', { reachedOut: 'received', ring: 'intending' }))).toBe(true)
    expect(wantsConnect(P('d', 'D', { reachedOut: 'sent', ring: 'intending' }))).toBe(false)
    expect(wantsConnect(P('d', 'D', { reachedOut: 'received', ring: 'friend' }))).toBe(false)
  })
})

describe('unread and mark all read (P1)', () => {
  it('everything counts until read; mark all read zeroes the badge and marks the inbox seen', () => {
    const s = state()
    expect(unreadCount(s, NOW)).toBe(centerItems(s, NOW).length)
    markAllRead(s, NOW)
    expect(unreadCount(s, NOW)).toBe(0)
    expect(s.notifInbox.every((i) => i.seenAt === NOW)).toBe(true)
  })
  it('a newer arrival counts again', () => {
    const s = state()
    markAllRead(s, NOW)
    s.wantsToConnect.push({ peerId: 'p9', name: 'Nina', at: NOW + 10 })
    expect(unreadCount(s, NOW + 20)).toBe(1)
  })
  it('an old record without any of the fields yields nothing', () => {
    expect(centerItems({ people: [] }, NOW)).toEqual([])
  })
})

describe('the "wants to connect" ring (A3)', () => {
  it('sits on the unsorted ring', () => {
    expect(webSlot({ ring: 'intending', reachedOut: 'received' })).toBe('unsorted')
    expect(webSlot({ ring: 'intending' })).toBe('intending')
    expect(webSlot({ ring: 'intending', reachedOut: 'sent' })).toBe('intending')
  })
})

describe('halo (B16)', () => {
  const F = { events: true, feed: true, inventory: true, people: true, map: true, mods: [] }
  const BAR = { order: ['web', 'chat', 'record', 'events', 'inventory', 'feed'] }
  const ids = (b) => resolveBar(b, F).ids
  it('a view that is the raised centre button shows no halo', () => {
    const bar = toggleHalo({ ...BAR, primary: 'chat' }, 'chat', F)
    expect(haloOf(bar, ids(bar), ['chat'])).toEqual([])
    expect(haloOf(bar, ids(bar), [])).toEqual(['chat'])
  })
  it('a halo does not come back when a hidden view returns (not pressed again)', () => {
    let bar = toggleHalo(BAR, 'feed', F)
    bar = setBarOrder(bar, ['web', 'chat', 'events'], F)
    bar = addBar(bar, 'feed', 'web', 'right', F)
    expect(haloOf(bar, ids(bar))).toEqual([])
  })
  it('hiding one view keeps the halo of the others and drops its own', () => {
    let bar = toggleHalo(toggleHalo(BAR, 'feed', F), 'events', F)
    bar = toggleBar(bar, 'feed', F)
    expect(haloOf(bar, ids(bar))).toEqual(['events'])
    bar = toggleBar(bar, 'feed', F)
    expect(haloOf(bar, ids(bar))).toEqual(['events'])
  })
  it('showViewInBar off drops the halo of that view', () => {
    const bar = showViewInBar({ ...BAR, halo: ['view:network'], order: [...BAR.order, 'view:network'] }, 'network', false)
    expect(bar.halo ?? []).toEqual([])
  })
})

describe('MCP parity: notifications_list, notifications_mark_read', () => {
  function fixture(write = true) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-nc-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, ...state(), sameAs: {}, meetings: [] }))
    const tools = recordTools({ file, write, now: () => new Date(NOW) })
    return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('list is a read; mark_read needs writes', () => {
    expect(Object.keys(fixture(false).by)).toContain('notifications_list')
    expect(Object.keys(fixture(false).by)).not.toContain('notifications_mark_read')
    expect(Object.keys(fixture().by)).toContain('notifications_mark_read')
  })
  it('list by section, with an unread count', () => {
    const { by } = fixture()
    const all = by.notifications_list.run({})
    expect(all.unread).toBe(all.items.length)
    expect(by.notifications_list.run({ section: 'connected' }).items.map((i) => i.title)).toEqual(['Ada', 'Cleo'])
    expect(() => by.notifications_list.run({ section: 'nope' })).toThrow(/section/)
  })
  it('mark_read zeroes the unread count and stores it in the record', () => {
    const { by, rec } = fixture()
    expect(by.notifications_mark_read.run({})).toMatchObject({ unread: 0 })
    expect(by.notifications_list.run({}).unread).toBe(0)
    expect(rec().notifInbox.every((i) => i.seenAt !== null)).toBe(true)
  })
})
