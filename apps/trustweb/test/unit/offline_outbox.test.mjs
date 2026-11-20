// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OUTBOX_BASE_MS, OUTBOX_HORIZON_MS, OUTBOX_MAX_ITEMS, OUTBOX_MAX_MS, OUTBOX_SENT_KEEP_MS, backoffMs, dueItems, enqueue, markFailed, markSent, nextDueAt, shownItems } from '../../src/outbox.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const T0 = 1_000_000
const item = (n = 1) => ({ peerId: 'p' + n, kind: 'text', env: { v: 1, t: 'chat', text: 'hi ' + n } })

describe('outbox backoff', () => {
  it('starts at the base, doubles, and stops at the cap', () => {
    expect(backoffMs(1)).toBe(OUTBOX_BASE_MS)
    expect(OUTBOX_BASE_MS).toBeGreaterThan(0)
    expect(backoffMs(2)).toBe(OUTBOX_BASE_MS * 2)
    expect(backoffMs(3)).toBe(OUTBOX_BASE_MS * 4)
    expect(backoffMs(40)).toBe(OUTBOX_MAX_MS)
    expect(backoffMs(Number.NaN)).toBe(OUTBOX_BASE_MS)
  })
})

describe('outbox queue', () => {
  it('queues an item as waiting, due at once, with a fresh id', () => {
    const s = {}
    const a = enqueue(s, item(1), T0)
    const b = enqueue(s, item(2), T0 + 1)
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ state: 'waiting', tries: 0, queuedAt: T0, nextAt: T0 })
    expect(s.sendQueue).toHaveLength(2)
    expect(dueItems(s, T0).map((x) => x.peerId)).toEqual(['p1'])
  })
  it('a failed send waits the backoff, a sent one leaves the due list and keeps its time', () => {
    const s = {}
    const a = enqueue(s, item(1), T0)
    markFailed(s, a.id, T0)
    expect(s.sendQueue[0]).toMatchObject({ state: 'waiting', tries: 1, nextAt: T0 + backoffMs(1) })
    expect(dueItems(s, T0)).toEqual([])
    expect(dueItems(s, T0 + backoffMs(1))).toHaveLength(1)
    expect(nextDueAt(s)).toBe(T0 + backoffMs(1))
    markSent(s, a.id, T0 + 5)
    expect(s.sendQueue[0]).toMatchObject({ state: 'sent', sentAt: T0 + 5 })
    expect(dueItems(s, T0 + 1e9)).toEqual([])
    expect(nextDueAt(s)).toBeUndefined()
  })
  it('a waiting item older than the horizon turns failed, never silently dropped', () => {
    const s = {}
    const a = enqueue(s, item(1), T0)
    markFailed(s, a.id, T0 + OUTBOX_HORIZON_MS + 1)
    expect(s.sendQueue[0].state).toBe('failed')
    expect(shownItems(s, T0 + OUTBOX_HORIZON_MS + 2)).toHaveLength(1)
  })
  it('shows waiting and failed items always, sent ones for a day; newest first', () => {
    const s = {}
    const a = enqueue(s, item(1), T0)
    const b = enqueue(s, item(2), T0 + 10)
    markSent(s, a.id, T0 + 20)
    expect(shownItems(s, T0 + 30).map((x) => x.id)).toEqual([b.id, a.id])
    expect(shownItems(s, T0 + 20 + OUTBOX_SENT_KEEP_MS + 1).map((x) => x.id)).toEqual([b.id])
  })
  it('is bounded: the oldest sent item goes first, a waiting one is never dropped to make room', () => {
    const s = {}
    for (let i = 0; i < OUTBOX_MAX_ITEMS + 5; i++) enqueue(s, item(i), T0 + i)
    expect(s.sendQueue.length).toBeLessThanOrEqual(OUTBOX_MAX_ITEMS + 5)
    const sent = s.sendQueue[0]
    markSent(s, sent.id, T0)
    enqueue(s, item(999), T0 + 1000)
    expect(s.sendQueue.find((x) => x.id === sent.id)).toBeUndefined()
    expect(s.sendQueue.filter((x) => x.state === 'waiting')).toHaveLength(OUTBOX_MAX_ITEMS + 5)
  })
  it('ignores unknown ids and a malformed list', () => {
    const s = { sendQueue: 'x' }
    expect(dueItems(s, T0)).toEqual([])
    markSent(s, 'nope', T0)
    const a = enqueue(s, item(1), T0)
    expect(s.sendQueue).toEqual([a])
  })
})

describe('MCP outbox_list', () => {
  it('lists what waits and what was sent, read-only', () => {
    const s = {}
    const a = enqueue(s, item(1), T0)
    enqueue(s, { peerId: 'p2', kind: 'event', env: { secret: 'x' } }, T0 + 1)
    markSent(s, a.id, T0 + 2)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-outbox-')), 'record.json')
    writeFileSync(file, JSON.stringify(s))
    const t = allTools({ file, write: false, now: () => new Date(T0 + 3) }).find((x) => x.name === 'outbox_list')
    const out = t.run({})
    expect(out.items.map((x) => `${x.kind}:${x.state}`)).toEqual(['event:waiting', 'text:sent'])
    expect(JSON.stringify(out)).not.toContain('secret')
    expect(out.waiting).toBe(1)
    expect(MCP_TOOLS).toContainEqual({ name: 'outbox_list', write: false })
  })
})
