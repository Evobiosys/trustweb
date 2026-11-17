// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 1 (D-P02, "mcp should be able to access everything"): ask_answer (the incoming ask: plain yes/no, the "may I show you" card,
 * the "who has it" box) + asks_incoming_list, and the read/write tools the full-access audit found missing (events, chats, groups, relations,
 * tasks, invitations, meetings). The view coverage map: every *_view.ts names the tool that reaches it, so a new view without one fails CI.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { viewCoverage, VIEW_TOOLS } from '../../../mcp/src/view_coverage.ts'
import { parityReport } from '../../../mcp/scripts/parity_check.mjs'
import { createActions } from '../../src/actions.ts'
import { defineA44dActions } from '../../src/a44d_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'

const NOW = Date.parse('2026-11-18T10:00:00Z')
const held = (qid, over = {}) => ({ qid, peerId: 'peer-b', text: 'a ladder?', fromName: 'Ben', through: [], doorName: null, relayed: false, matches: [{ threadId: 't1', text: 'Ladder', context: '', at: 1 }], receivedAt: NOW - 60_000, deadline: NOW + 60_000, lateMode: true, ...over })
const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Ana' },
  people: [{ id: 'b', name: 'Ben Gruber', ring: 'close', lines: [], peerId: 'peer-b', events: ['e1'], fields: { iyg: 'true', email: 'ben@x.org' } }, { id: 'c', name: 'Cleo', ring: 'friend', lines: [] }],
  peers: [{ id: 'peer-b', displayName: 'Ben' }],
  heldAsks: [held('q1'), held('q2', { know: true, text: 'who has a van?' }), held('q3', { show: 'Omar', text: 'may Omar see you?' }), held('q4', { yesAt: NOW - 1000 })],
  events: [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, hosts: ['Ana'], communityId: 'iyg' }],
  chats: { 'peer-b': { unread: 1, messages: [{ key: 'k1', dir: 'in', text: 'hi', at: NOW - 5000, sentAt: NOW - 5000, state: 'received' }, { key: 'k2', dir: 'out', text: 'hello', at: NOW - 4000, sentAt: NOW - 4000, state: 'delivered' }] } },
  groups: [{ id: 'g1', name: 'Choir', tags: ['choir'], members: ['b'], updatedAt: 1 }],
  relations: [{ a: 'b', b: 'c', kind: 'partner', at: 1 }],
  tasks: [{ id: 't1', title: 'Call Ben', people: ['b'] }, { id: 't2', title: 'Done thing', done: 5 }],
  invitations: [{ id: 'inv1', kind: 'invitation', event: 'Gala', host: 'b', date: '2026-12-01', status: 'open' }],
  meetings: [{ id: 'm1', about: 'Ben', kind: 'person', personId: 'b', where: 'Cafe', startedAt: NOW - 9e6, endedAt: NOW - 8e6, durationMs: 1e6, meeting: true, lines: [{ text: 'likes jazz', tag: 'about' }], transcript: [] }],
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-a44d-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = allTools({ file, write, now: () => new Date(NOW) })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('asks_incoming_list / ask_answer', () => {
  it('lists the open incoming asks with their card kind; one already answered yes is not open', () => {
    const rows = fixture(false).by.asks_incoming_list.run({})
    expect(rows.map((r) => [r.qid, r.kind])).toEqual([['q1', 'share'], ['q2', 'know'], ['q3', 'show']])
    expect(rows[2].show).toBe('Omar')
    expect(rows[0]).toMatchObject({ from: 'Ben', text: 'a ladder?', matches: ['Ladder'] })
  })
  it('ask_answer queues the answer for the open app; nothing else is written', () => {
    const f = fixture()
    const before = readFileSync(f.file, 'utf8')
    expect(f.by.ask_answer.run({ qid: 'q1', answer: 'yes' })).toEqual({ queued: true, qid: 'q1', kind: 'share', answer: 'yes' })
    f.by.ask_answer.run({ qid: 'q2', answer: 'yes', note: 'Lena has one', who: 'Lena' })
    f.by.ask_answer.run({ qid: 'q3', answer: 'no' })
    expect(readFileSync(f.file, 'utf8')).toBe(before)
    const acts = readEvents(f.file, 0).events.map((e) => e.action)
    expect(acts).toEqual([
      { type: 'ask-answer', args: { qid: 'q1', yes: true } },
      { type: 'ask-answer', args: { qid: 'q2', yes: true, note: 'Lena has one', who: 'Lena' } },
      { type: 'ask-answer', args: { qid: 'q3', yes: false } },
    ])
  })
  it('refuses an unknown or answered ask, a know-yes without a tip, a note or who on a plain card, a bad answer', () => {
    const { by } = fixture()
    expect(() => by.ask_answer.run({ qid: 'nope', answer: 'yes' })).toThrow(/no open ask/)
    expect(() => by.ask_answer.run({ qid: 'q4', answer: 'yes' })).toThrow(/no open ask/)
    expect(() => by.ask_answer.run({ qid: 'q2', answer: 'yes' })).toThrow(/note/)
    expect(() => by.ask_answer.run({ qid: 'q1', answer: 'yes', who: 'Lena' })).toThrow(/who/)
    expect(() => by.ask_answer.run({ qid: 'q3', answer: 'yes', note: 'x' })).toThrow(/note/)
    expect(() => by.ask_answer.run({ qid: 'q1', answer: 'maybe' })).toThrow(/yes or no/)
  })
  it('read-only mode has the list, not the answer', () => {
    const names = Object.keys(fixture(false).by)
    expect(names).toContain('asks_incoming_list')
    expect(names).not.toContain('ask_answer')
    expect(names).not.toContain('chat_send')
  })
})

describe('the registry actions behind the queued tools', () => {
  it('ask-answer and chat-send map to their tools and reach the host', async () => {
    const reg = createActions()
    const calls = []
    defineA44dActions(reg, { answerAsk: (...a) => { calls.push(['answer', ...a]); return true }, sendChat: (...a) => { calls.push(['chat', ...a]); return Promise.resolve(true) } })
    expect(ACTION_MCP['ask-answer']).toBe('ask_answer')
    expect(ACTION_MCP['chat-send']).toBe('chat_send')
    reg.do('ask-answer', { qid: 'q2', yes: true, note: 'tip', who: 'Lena' })
    reg.do('chat-send', { person: 'b', text: 'hi there' })
    expect(calls).toEqual([['answer', 'q2', true, 'tip', 'Lena'], ['chat', 'b', 'hi there']])
  })
})

describe('the audit read tools', () => {
  const { by } = fixture(false)
  it('events_list / event_get', () => {
    expect(by.events_list.run({})).toEqual([{ id: 'e1', name: 'Winter OG', from: '2026-12-30', where: 'Vienna', community: 'iyg', attendees: 1 }])
    expect(by.event_get.run({ event: 'Winter OG' })).toMatchObject({ id: 'e1', hosts: ['Ana'], attendees: [{ id: 'b', name: 'Ben Gruber' }] })
    expect(() => by.event_get.run({ event: 'nope' })).toThrow(/no event/)
  })
  it('chats_list / chat_read: text only, no channels', () => {
    expect(by.chats_list.run({})).toEqual([{ person: 'b', name: 'Ben Gruber', unread: 1, last: 'hello', lastAt: new Date(NOW - 4000).toISOString() }])
    const t = by.chat_read.run({ person: 'Ben Gruber' })
    expect(t.messages.map((m) => [m.dir, m.text])).toEqual([['in', 'hi'], ['out', 'hello']])
    expect(JSON.stringify(t)).not.toContain('ben@x.org')
  })
  it('groups, relations, tasks, invitations, meetings', () => {
    expect(by.groups_list.run({})).toEqual([{ id: 'g1', name: 'Choir', members: ['Ben Gruber'], tags: ['choir'] }])
    expect(by.relations_list.run({})).toEqual([{ a: 'Ben Gruber', b: 'Cleo', kind: 'partner' }])
    expect(by.tasks_list.run({}).map((t) => t.id)).toEqual(['t1'])
    expect(by.tasks_list.run({ done: true }).map((t) => t.id)).toEqual(['t1', 't2'])
    expect(by.invitations_list.run({})).toEqual([{ id: 'inv1', event: 'Gala', host: 'Ben Gruber', date: '2026-12-01', status: 'open' }])
    expect(by.meetings_list.run({})[0]).toMatchObject({ id: 'm1', about: 'Ben', where: 'Cafe', notes: ['likes jazz'] })
  })
  it('chat_send queues the text for the open app', () => {
    const f = fixture()
    expect(f.by.chat_send.run({ person: 'b', text: ' hi there ' })).toEqual({ queued: true, person: 'b' })
    expect(readEvents(f.file, 0).events[0].action).toEqual({ type: 'chat-send', args: { person: 'b', text: 'hi there' } })
    expect(() => f.by.chat_send.run({ person: 'c', text: 'x' })).toThrow(/not connected/)
  })
})

describe('the view coverage map (a new view without a tool fails CI)', () => {
  it('every *_view.ts of the app is mapped to tools that exist', () => {
    const r = parityReport()
    expect(r.missing).toEqual([])
    expect(r.views).toBeGreaterThan(100)
  })
  it('an unmapped view, or one naming an unknown tool, is reported', () => {
    const tools = ['list_people', 'app_action']
    expect(viewCoverage(['people_list_view.ts', 'brand_new_view.ts'], tools, { 'people_list_view.ts': ['list_people'] })).toEqual(['view brand_new_view.ts has no MCP tool (apps/mcp/src/view_coverage.ts)'])
    expect(viewCoverage(['x_view.ts'], tools, { 'x_view.ts': ['ghost_tool'] })).toEqual(['view x_view.ts -> ghost_tool (no such tool)'])
    expect(Object.keys(VIEW_TOOLS).length).toBeGreaterThan(100)
  })
})
