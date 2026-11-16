// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c connect-extras, MCP parity (P02): event_envelope_send (debug), feed_sources_get/set, community_dashboard_share_set. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createActions } from '../../src/actions.ts'
import { defineEventActions } from '../../src/event_actions.ts'

const base = () => ({
  v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'p1', name: 'Ada Example', context: '', ring: 'friend', metAt: 0, lines: [], peerId: 'peer1' }],
  events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }],
  feed: { on: true },
  extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } }, sameAs: {}, meetings: [],
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpce-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('feed_sources_get / feed_sources_set', () => {
  it('get is a read; set needs writes on', () => {
    expect(Object.keys(fixture(false).by)).toContain('feed_sources_get')
    expect(Object.keys(fixture(false).by)).not.toContain('feed_sources_set')
    expect(Object.keys(fixture().by)).toContain('feed_sources_set')
  })
  it('get names the default instance and that posting is off', () => {
    expect(fixture().by.feed_sources_get.run({})).toMatchObject({ remote: false, images: false, follows: [], mastodonDefaultInstance: 'mastodon.social', mastodonPostEnabled: false })
  })
  it('set changes the switches, follows (validated and normalised) and the news address', () => {
    const f = fixture()
    const out = f.by.feed_sources_set.run({ remote: true, images: true, follows: ['#event_Winter_IYG@mastodon.social', '@ada@mastodon.social'], newsUrl: 'https://news.example.org/feed.xml' })
    expect(out).toMatchObject({ remote: true, images: true, follows: ['#event_Winter_IYG@mastodon.social', '@ada@mastodon.social'], newsUrl: 'https://news.example.org/feed.xml' })
    expect(f.rec().feed).toMatchObject({ on: true, remote: true, images: true })
    expect(f.by.feed_sources_set.run({ newsUrl: '' }).newsUrl).toBe('')
    expect(f.rec().feed.newsUrl).toBeUndefined()
  })
  it('set refuses a bad follow or news address and changes nothing', () => {
    const f = fixture()
    expect(() => f.by.feed_sources_set.run({ follows: ['not a handle'] })).toThrow(/follow/i)
    expect(() => f.by.feed_sources_set.run({ newsUrl: 'javascript:alert(1)' })).toThrow(/news/i)
    expect(f.rec().feed).toEqual({ on: true })
  })
})

describe('community_dashboard_share_set', () => {
  it('is a write tool; on mints one anonymous slot, off keeps it and sets the switch to false', () => {
    expect(Object.keys(fixture(false).by)).not.toContain('community_dashboard_share_set')
    const f = fixture()
    const on = f.by.community_dashboard_share_set.run({ community: 'iyg', on: true })
    expect(on).toMatchObject({ community: 'iyg', shareLayout: true })
    const slot = f.rec().extData['community-mighty'].meta.iyg.slot
    expect(slot).toMatch(/^[0-9a-f]{16,64}$/)
    expect(f.by.community_dashboard_share_set.run({ community: 'iyg', on: false })).toMatchObject({ shareLayout: false })
    expect(f.rec().extData['community-mighty'].meta.iyg).toMatchObject({ shareLayout: false, slot })
  })
  it('refuses an unknown community and a missing on', () => {
    const f = fixture()
    expect(() => f.by.community_dashboard_share_set.run({ community: 'nope', on: true })).toThrow(/no community/)
    expect(() => f.by.community_dashboard_share_set.run({ community: 'iyg' })).toThrow(/on/)
  })
})

describe('event_envelope_send (debug)', () => {
  it('queues the step for the open preview, names the event and the person, and checks both exist', () => {
    const f = fixture()
    expect(f.by.event_envelope_send.run({ event: 'e1', person: 'Ada Example' })).toMatchObject({ queued: true })
    const ev = readEvents(f.file, 0).events.at(-1)
    expect(ev).toMatchObject({ kind: 'action', tool: 'event_envelope_send', action: { type: 'event-envelope-send', args: { event: 'e1', person: 'p1' } } })
    expect(() => f.by.event_envelope_send.run({ event: 'zzz', person: 'p1' })).toThrow(/no event/)
    expect(() => f.by.event_envelope_send.run({ event: 'e1', person: 'Nobody' })).toThrow(/no person/)
  })
  it('is not offered with writes off', () => { expect(Object.keys(fixture(false).by)).not.toContain('event_envelope_send') })
  it('the app side: the card sends through the host and needs approval', () => {
    const sent = []
    const reg = createActions()
    defineEventActions(reg, { state: () => ({ events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }] }), save: () => undefined, newId: () => 'x', sendEnvelope: (ev, person) => { sent.push([ev.id, person]) } })
    expect(reg.specs().find((s) => s.type === 'event-envelope-send')?.auto).toBe(false)
    reg.do('event-envelope-send', { event: 'e1', person: 'p1' }, 'assistant')
    expect(sent).toEqual([['e1', 'p1']])
    expect(() => reg.do('event-envelope-send', { event: 'nope', person: 'p1' })).toThrow(/no event/)
  })
})
