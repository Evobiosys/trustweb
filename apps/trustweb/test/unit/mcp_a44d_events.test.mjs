// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-44d item 4, MCP parity (D-P02): event_share_audience_set, community_intimate_set, event_chat_open, event_message_all, and event_get's new fields. Fake data. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineA44dActions } from '../../src/a44d_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], ...over })
const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Ana' },
  people: [P('b', 'Ben', { events: ['e1'], fields: { iyg: 'true' } }), P('c', 'Cleo', { fields: { iyg: 'true' } }), P('h', 'Hanna')],
  events: [{ id: 'e1', name: 'Winter OG', from: '2026-12-30', where: '', createdAt: 1, attended: true, hosts: ['Hanna'], communityId: 'iyg' }, { id: 'e2', name: 'Solo', from: '2026-12-01', where: '', createdAt: 1, attended: true }],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } },
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-a44d-ev-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  return { file, by: Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-18T10:00:00Z') }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('event_get: the page top', () => {
  it('hosted by, joining (hosts left out), the community, its members when intimate, the share audience', () => {
    expect(fixture(false).by.event_get.run({ event: 'e1' })).toMatchObject({ hostedBy: ['Hanna'], joining: ['Ben'], community: 'iyg', intimate: true, communityMembers: ['Cleo'], shareAudience: 'community' })
    expect(fixture(false).by.event_get.run({ event: 'e2' })).toMatchObject({ community: null, intimate: false, communityMembers: [], shareAudience: null })
  })
})

describe('event_share_audience_set / community_intimate_set', () => {
  it('Choose later is stored, community is the default (not stored); a personal event has no audience', () => {
    const f = fixture()
    expect(f.by.event_share_audience_set.run({ event: 'Winter OG', audience: 'later' })).toEqual({ id: 'e1', shareAudience: 'later' })
    expect(f.rec().events[0].shareAudience).toBe('later')
    f.by.event_share_audience_set.run({ event: 'e1', audience: 'community' })
    expect('shareAudience' in f.rec().events[0]).toBe(false)
    expect(() => f.by.event_share_audience_set.run({ event: 'e2', audience: 'later' })).toThrow(/community/)
    expect(() => f.by.event_share_audience_set.run({ event: 'e1', audience: 'all' })).toThrow(/community or later/)
  })
  it('the intimate flag of a community', () => {
    const f = fixture()
    expect(f.by.community_intimate_set.run({ community: 'iyg', intimate: false })).toEqual({ id: 'iyg', intimate: false })
    expect(f.rec().extData['community-mighty'].meta.iyg.intimate).toBe(false)
    expect(f.by.event_get.run({ event: 'e1' })).toMatchObject({ intimate: false, communityMembers: [] })
    expect(() => f.by.community_intimate_set.run({ community: 'iyg', intimate: 'yes' })).toThrow(/true or false/)
  })
})

describe('event_chat_open / event_message_all: queued for the open app', () => {
  it('queue the registry actions; an unknown event is refused', () => {
    const f = fixture()
    expect(f.by.event_chat_open.run({ event: 'e1' })).toEqual({ queued: true, event: 'e1' })
    expect(f.by.event_message_all.run({ event: 'Winter OG', text: ' see you ' })).toEqual({ queued: true, event: 'e1' })
    expect(readEvents(f.file, 0).events.map((e) => e.action)).toEqual([{ type: 'event-chat-open', args: { event: 'e1' } }, { type: 'event-message-all', args: { event: 'e1', text: 'see you' } }])
    expect(() => f.by.event_chat_open.run({ event: 'nope' })).toThrow(/no event/)
  })
  it('the registry actions reach the host', () => {
    const reg = createActions()
    const calls = []
    defineA44dActions(reg, { answerAsk: () => true, sendChat: () => Promise.resolve(true), openEventChat: (id) => calls.push(['open', id]), messageAll: (id, t) => { calls.push(['all', id, t]); return Promise.resolve(1) } })
    reg.do('event-chat-open', { event: 'e1' }); reg.do('event-message-all', { event: 'e1', text: 'hi' })
    expect(calls).toEqual([['open', 'e1'], ['all', 'e1', 'hi']])
    expect(ACTION_MCP['event-chat-open']).toBe('event_chat_open')
    expect(ACTION_MCP['event-message-all']).toBe('event_message_all')
  })
})
