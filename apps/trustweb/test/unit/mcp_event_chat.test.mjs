// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 event-group-chat, MCP parity: event_chat_open (queued), event_chat_read (the shared thread), event_chat_send / event_chat_leave (queued), and the registry actions. Fake data. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineA44dActions } from '../../src/a44d_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [{ id: 'b', name: 'Ben', ring: 'friend', lines: [], events: ['e1'] }],
  events: [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', where: '', createdAt: 1, attended: true, hosts: ['Hanna'] }],
  eventChats: { e1: { unread: 1, mem: { me: { on: true, at: 5 } }, items: [
    { m: 'a1', k: 'join', by: 'Ben', ts: 1_000, at: 1_000 },
    { m: 'a2', k: 'msg', by: 'Ben', ts: 2_000, at: 2_000, text: 'Who brings tea?' },
    { m: 'a3', k: 'msg', by: 'Ana', ts: 3_000, at: 3_000, text: 'I do', mine: true, state: 'pending' },
  ] } },
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-w45gc-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  return { file, by: Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-19T10:00:00Z') }).map((t) => [t.name, t])) }
}

describe('event_chat_read: the event\'s one shared thread', () => {
  it('items oldest first (kind, author, text, time, mine, waiting), unread, whether I left; unknown event refused', () => {
    const out = fixture(false).by.event_chat_read.run({ event: 'Winter OG' })
    expect(out).toMatchObject({ event: 'e1', name: 'Winter OG', unread: 1, left: false })
    expect(out.items).toEqual([
      { kind: 'join', by: 'Ben', text: '', at: new Date(1_000).toISOString(), mine: false, waiting: false },
      { kind: 'msg', by: 'Ben', text: 'Who brings tea?', at: new Date(2_000).toISOString(), mine: false, waiting: false },
      { kind: 'msg', by: 'Ana', text: 'I do', at: new Date(3_000).toISOString(), mine: true, waiting: true },
    ])
    expect(() => fixture(false).by.event_chat_read.run({ event: 'nope' })).toThrow(/no event/)
  })
})

describe('event_chat_send / event_chat_leave: queued for the open app', () => {
  it('queue the registry actions with the event id; empty or too long text and a non-boolean leave are refused', () => {
    const f = fixture()
    expect(f.by.event_chat_send.run({ event: 'Winter OG', text: ' see you ' })).toEqual({ queued: true, event: 'e1' })
    expect(f.by.event_chat_leave.run({ event: 'e1', leave: true })).toEqual({ queued: true, event: 'e1', leave: true })
    expect(readEvents(f.file, 0).events.map((e) => e.action)).toEqual([{ type: 'event-chat-send', args: { event: 'e1', text: 'see you' } }, { type: 'event-chat-leave', args: { event: 'e1', leave: true } }])
    expect(() => f.by.event_chat_send.run({ event: 'e1', text: '  ' })).toThrow(/text/)
    expect(() => f.by.event_chat_send.run({ event: 'e1', text: 'x'.repeat(2001) })).toThrow(/too long/)
    expect(() => f.by.event_chat_leave.run({ event: 'e1', leave: 'yes' })).toThrow(/true or false/)
  })
  it('read-only server: event_chat_read only; the Settings list and the action map know the tools', () => {
    const ro = fixture(false).by
    expect(ro.event_chat_read).toBeTruthy()
    expect(ro.event_chat_send).toBeUndefined()
    expect(MCP_TOOLS).toEqual(expect.arrayContaining([{ name: 'event_chat_read', write: false }, { name: 'event_chat_send', write: true }, { name: 'event_chat_leave', write: true }]))
    expect(ACTION_MCP['event-chat-send']).toBe('event_chat_send')
    expect(ACTION_MCP['event-chat-leave']).toBe('event_chat_leave')
  })
  it('the registry actions reach the host', () => {
    const reg = createActions()
    const calls = []
    defineA44dActions(reg, { answerAsk: () => true, sendChat: () => Promise.resolve(true), openEventChat: (id) => calls.push(['open', id]), messageAll: (id, t) => { calls.push(['send', id, t]); return Promise.resolve(1) }, leaveEventChat: (id, l) => { calls.push(['leave', id, l]); return Promise.resolve(true) } })
    reg.run({ type: 'event-chat-send', args: { event: 'e1', text: 'hi' } })
    reg.run({ type: 'event-chat-leave', args: { event: 'e1', leave: false } })
    expect(calls).toEqual([['send', 'e1', 'hi'], ['leave', 'e1', false]])
  })
})
