// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-notify-dismiss: acting on a notification row dismisses it (normal-notification semantics); it stays gone, a newer arrival returns. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { centerItems, dismissNotification, listNotifications, unreadCount } from '../../src/notify_center.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const NOW = Date.UTC(2026, 10, 15, 12)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })
const state = () => ({
  people: [P('a', 'Ada', { peerId: 'pa' })],
  peers: [{ id: 'pa', displayName: 'pa', did: 'pa', ring: 'friend', connectedAt: NOW - 1000 }],
  chats: { pa: { unread: 1, messages: [{ at: NOW - 500, text: 'hi', mine: false }] } },
  wantsToConnect: [{ peerId: 'pw', name: 'Wanda', at: NOW - 3000 }],
  notifInbox: [{ id: 'i1', kind: 'event', title: 'T', body: 'Eve joined', at: NOW - 4000, seenAt: null }],
})

describe('dismissNotification', () => {
  it('the row disappears from its section and the unread count drops by one', () => {
    const s = state()
    const before = unreadCount(s, NOW)
    expect(dismissNotification(s, 'conn:a', NOW)).toBe(true)
    expect(centerItems(s, NOW).some((i) => i.id === 'conn:a')).toBe(false)
    expect(unreadCount(s, NOW)).toBe(before - 1)
    expect(listNotifications(s, 'connected', NOW)).toEqual([])
  })
  it('every row kind can be dismissed, an inbox row is marked seen', () => {
    const s = state()
    for (const i of centerItems(s, NOW)) dismissNotification(s, i.id, NOW)
    expect(centerItems(s, NOW)).toEqual([])
    expect(s.notifInbox[0].seenAt).toBe(NOW)
  })
  it('a newer message from the same person comes back', () => {
    const s = state()
    dismissNotification(s, 'msg:pa', NOW)
    expect(centerItems(s, NOW).some((i) => i.id === 'msg:pa')).toBe(false)
    s.chats.pa.messages.push({ at: NOW + 10, text: 'again', mine: false })
    expect(centerItems(s, NOW + 20).some((i) => i.id === 'msg:pa')).toBe(true)
  })
  it('persists in the record (JSON round trip) and an unknown id changes nothing', () => {
    const s = state()
    expect(dismissNotification(s, 'nope', NOW)).toBe(false)
    dismissNotification(s, 'want:pw', NOW)
    const back = JSON.parse(JSON.stringify(s))
    expect(centerItems(back, NOW).some((i) => i.id === 'want:pw')).toBe(false)
  })
})

describe('MCP parity: notification_dismiss', () => {
  function fixture(write = true) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-nd-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, ...state(), sameAs: {}, meetings: [] }))
    const tools = recordTools({ file, write, now: () => new Date(NOW) })
    return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('needs writes', () => {
    expect(Object.keys(fixture(false).by)).not.toContain('notification_dismiss')
    expect(Object.keys(fixture().by)).toContain('notification_dismiss')
  })
  it('dismisses one row and reports the unread count', () => {
    const { by, rec } = fixture()
    const n = by.notifications_list.run({}).unread
    expect(by.notification_dismiss.run({ id: 'conn:a' })).toMatchObject({ unread: n - 1 })
    expect(by.notifications_list.run({}).items.some((i) => i.id === 'conn:a')).toBe(false)
    expect(rec().notifDismissed['conn:a']).toBeTypeOf('number')
  })
  it('an unknown id is an error', () => {
    expect(() => fixture().by.notification_dismiss.run({ id: 'zzz' })).toThrow(/id/)
  })
})
