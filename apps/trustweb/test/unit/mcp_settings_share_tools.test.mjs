// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 settings-suggest, MCP parity: settings_suggest / settings_follow / settings_suggestions_list / settings_suggestion_accept over a record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { settingsShareTools } from '../../../mcp/src/settings_share_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write, extra = {}) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-ss-')), 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [{ id: 'ben', name: 'Ben', ring: 'close' }], ...extra }))
  const tools = settingsShareTools({ file, write, now: () => new Date(1000) })
  return { file, tools, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}
const incoming = { inbox: [{ id: 'ben:s1', t: 'suggest', from: 'ben', group: 'feed', values: { 'feed.on': true }, at: 5 }, { id: 'ben:f1', t: 'follow', from: 'ben', group: 'privacy', at: 6 }] }

describe('settings share MCP tools', () => {
  it('read-only offers the list; write adds suggest, follow, accept; MCP_TOOLS marks them', () => {
    expect(fixture(false).tools.map((t) => t.name)).toEqual(['settings_suggestions_list'])
    expect(fixture(true).tools.map((t) => t.name).sort()).toEqual(['settings_follow', 'settings_suggest', 'settings_suggestion_accept', 'settings_suggestions_list'])
    for (const [name, write] of [['settings_suggestions_list', false], ['settings_suggest', true], ['settings_follow', true], ['settings_suggestion_accept', true]]) expect(MCP_TOOLS).toContainEqual({ name, write })
  })
  it('settings_suggestions_list: each item with name, group, kind and the diff it would make; my follows and followers', () => {
    const { by } = fixture(false, { settingsShare: { ...incoming, book: [{ from: 'me', to: 'ben', topic: 'events', auto: true, since: 1 }] } })
    const out = by.settings_suggestions_list.run({})
    expect(out.groups).toEqual(['privacy', 'feed', 'notifications', 'events'])
    expect(out.suggestions[0]).toMatchObject({ id: 'ben:s1', kind: 'suggest', from: 'ben', fromName: 'Ben', group: 'feed', changes: [{ id: 'feed.on', from: false, to: true }] })
    expect(out.suggestions[0].changes[0].label).toBeTruthy()
    expect(out.suggestions[1]).toMatchObject({ id: 'ben:f1', kind: 'follow', group: 'privacy' })
    expect(out.following).toEqual([{ group: 'events', person: 'ben', name: 'Ben', auto: true, waiting: false }])
    expect(out.followers).toEqual([])
  })
  it('settings_suggest queues the group for the person; refuses an unknown group or person', () => {
    const { by, rec } = fixture(true)
    expect(by.settings_suggest.run({ person: 'Ben', group: 'feed' })).toMatchObject({ queued: true, to: 'ben', group: 'feed' })
    expect(rec().settingsShare.outbox[0].msg).toMatchObject({ t: 'suggest', group: 'feed', values: { 'feed.on': false } })
    expect(() => by.settings_suggest.run({ person: 'ben', group: 'colours' })).toThrow(/group/)
    expect(() => by.settings_suggest.run({ person: 'zed', group: 'feed' })).toThrow(/person/)
  })
  it('settings_follow follows (with auto-apply), switches auto-apply, and stops', () => {
    const { by, rec } = fixture(true)
    expect(by.settings_follow.run({ person: 'ben', group: 'privacy', auto: true })).toMatchObject({ following: 'ben', group: 'privacy', auto: true })
    expect(rec().settingsShare.book).toEqual([{ from: 'me', to: 'ben', topic: 'privacy', auto: true, since: 1000 }])
    by.settings_follow.run({ group: 'privacy', auto: false })
    expect(rec().settingsShare.book[0].auto).toBe(false)
    expect(by.settings_follow.run({ group: 'privacy', on: false })).toMatchObject({ following: null })
    expect(rec().settingsShare.book).toEqual([])
    expect(() => by.settings_follow.run({ group: 'feed', auto: true })).toThrow(/follow nobody/)
  })
  it('settings_suggestion_accept applies a suggestion, allows a follow, declines', () => {
    const { by, rec } = fixture(true, { settingsShare: incoming })
    expect(by.settings_suggestion_accept.run({ id: 'ben:s1' })).toEqual({ id: 'ben:s1', accepted: true, applied: ['feed.on'] })
    expect(rec().feed).toEqual({ on: true })
    by.settings_suggestion_accept.run({ id: 'ben:f1', accept: true })
    expect(rec().settingsShare.book).toEqual([{ from: 'ben', to: 'me', topic: 'privacy', auto: false, since: 1000 }])
    expect(rec().settingsShare.outbox[0]).toMatchObject({ to: 'ben', msg: { t: 'suggest', group: 'privacy', follow: true } })
    expect(() => by.settings_suggestion_accept.run({ id: 'nope', accept: false })).toThrow(/suggestion/)
  })
})
