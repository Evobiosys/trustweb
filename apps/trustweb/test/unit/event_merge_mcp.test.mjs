// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 merge-events, MCP parity (P02): event_merge, event_merge_answer (queued for the open app: only it holds the pair keys), event_merge_asks_list; the registry actions behind them. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineEventMergeActions } from '../../src/event_merge_actions.ts'
import { SYNC_EXCLUDED } from '../../src/sync_core.ts'
import { mcpToolFor } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const ev = (id, name, extra = {}) => ({ id, name, from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, ...extra })
const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'p1', name: 'Ada Example', context: '', ring: 'friend', metAt: 0, lines: [], peerId: 'peer1' }],
  events: [ev('e1', 'Winter IYG', { hosts: ['Tester'] }), ev('e2', 'IYG Winter', { hosts: ['Tester'] }), ev('e3', 'Not mine', { hosts: ['Ada Example'], fromLink: true })],
  eventMergeAsks: [{ dir: 'in', keep: 'e3', gone: 'e2', peer: 'peer1', from: 'Ada Example', at: 5, link: 'https://app.trustweb.one/#ev=x' }],
  eventMerged: { old1: 'e1' }, sameAs: {}, meetings: [],
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpmerge-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = allTools({ file, write, now: () => new Date('2026-11-19T10:00:00Z') })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('event_merge_asks_list', () => {
  it('is a read: the asks (no peer ids) and the redirects', () => {
    const f = fixture(false)
    expect(f.by.event_merge_asks_list.run({})).toEqual({
      asks: [{ dir: 'in', keep: 'e3', keepName: 'Not mine', gone: 'e2', goneName: 'IYG Winter', from: 'Ada Example', at: '1970-01-01T00:00:00.005Z' }],
      merged: { old1: 'e1' },
    })
  })
})

describe('event_merge', () => {
  it('queues the merge for the open app and says whether it merges at once or asks', () => {
    const f = fixture()
    expect(f.by.event_merge.run({ keep: 'e1', gone: 'e2' })).toEqual({ queued: true, keep: 'e1', gone: 'e2', mode: 'now' })
    expect(f.by.event_merge.run({ keep: 'Winter IYG', gone: 'e3' })).toMatchObject({ queued: true, mode: 'ask' })
    expect(readEvents(f.file, 0).events.filter((e) => e.kind === 'action').map((e) => e.action)).toEqual([
      { type: 'event-merge', args: { keep: 'e1', gone: 'e2' } }, { type: 'event-merge', args: { keep: 'e1', gone: 'e3' } }])
    expect(f.rec().events).toHaveLength(3)
  })
  it('refuses the same event, an unknown event and an event I do not host', () => {
    const f = fixture()
    expect(() => f.by.event_merge.run({ keep: 'e1', gone: 'e1' })).toThrow(/two different/)
    expect(() => f.by.event_merge.run({ keep: 'e1', gone: 'zzz' })).toThrow(/no event/)
    expect(() => f.by.event_merge.run({ keep: 'e3', gone: 'e1' })).toThrow(/host/)
  })
  it('is not offered with writes off', () => {
    const names = Object.keys(fixture(false).by)
    expect(names).not.toContain('event_merge')
    expect(names).not.toContain('event_merge_answer')
  })
})

describe('event_merge_answer', () => {
  it('queues my answer to an ask that is there; refuses one that is not', () => {
    const f = fixture()
    expect(f.by.event_merge_answer.run({ keep: 'e3', gone: 'e2', yes: true })).toEqual({ queued: true, keep: 'e3', gone: 'e2', yes: true })
    expect(readEvents(f.file, 0).events.at(-1).action).toEqual({ type: 'event-merge-answer', args: { keep: 'e3', gone: 'e2', yes: true } })
    expect(() => f.by.event_merge_answer.run({ keep: 'e1', gone: 'e2', yes: true })).toThrow(/no merge ask/)
    expect(() => f.by.event_merge_answer.run({ keep: 'e3', gone: 'e2' })).toThrow(/yes/)
  })
})

describe('the app side: registry actions, parity, sync', () => {
  it('each action needs approval and runs through the host', async () => {
    const calls = []
    const reg = createActions()
    defineEventMergeActions(reg, { start: async (k, g) => { calls.push(['start', k, g]); return 'merged' }, answer: async (k, g, y) => { calls.push(['answer', k, g, y]); return true } })
    for (const t of ['event-merge', 'event-merge-answer']) expect(reg.specs().find((s) => s.type === t)?.auto).toBe(false)
    reg.do('event-merge', { keep: 'e1', gone: 'e2' }, 'assistant')
    reg.do('event-merge-answer', { keep: 'e3', gone: 'e2', yes: false }, 'assistant')
    expect(calls).toEqual([['start', 'e1', 'e2'], ['answer', 'e3', 'e2', false]])
    expect(() => reg.do('event-merge', { keep: 'e1', gone: 'e1' })).toThrow(/two different/)
  })
  it('the tools are listed and mapped', () => {
    expect(mcpToolFor('event-merge')).toBe('event_merge')
    expect(mcpToolFor('event-merge-answer')).toBe('event_merge_answer')
    expect(MCP_TOOLS.filter((t) => t.name.startsWith('event_merge'))).toEqual([{ name: 'event_merge_asks_list', write: false }, { name: 'event_merge', write: true }, { name: 'event_merge_answer', write: true }])
  })
  it('asks name peer ids: they stay on this device; the redirects travel as a setting', () => {
    expect(SYNC_EXCLUDED.has('eventMergeAsks')).toBe(true)
    expect(SYNC_EXCLUDED.has('eventMerged')).toBe(false)
  })
})
