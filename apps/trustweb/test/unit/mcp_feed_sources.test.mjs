// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-sources, MCP parity (P02): feed_source_toggle, feed_algorithm_set, feed_no_public_read_set, feed_publish_target_set. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpfs-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], sameAs: {}, meetings: [], me: { id: 'me', displayName: 'Tester' }, feed: { on: true } }))
  const tools = allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), feed: () => JSON.parse(readFileSync(file, 'utf8')).feed }
}
const NAMES = ['feed_source_toggle', 'feed_algorithm_set', 'feed_no_public_read_set', 'feed_publish_target_set']

describe('feed sources tools', () => {
  it('are changes: absent without writes, present with; listed in MCP_TOOLS as writes', () => {
    expect(Object.keys(fixture(false).by).filter((n) => NAMES.includes(n))).toEqual([])
    expect(Object.keys(fixture().by)).toEqual(expect.arrayContaining(NAMES))
    for (const n of NAMES) expect(MCP_TOOLS.find((t) => t.name === n)?.write).toBe(true)
  })
  it('feed_source_toggle switches a source and sets its filters', () => {
    const f = fixture()
    expect(f.by.feed_source_toggle.run({ id: 'bluesky', on: true })).toMatchObject({ id: 'bluesky', on: true })
    f.by.feed_source_toggle.run({ id: 'mastodon', trustedOnly: true, publicAllowed: true, mute: ['spam', 'ads'] })
    expect(f.feed().sources).toEqual({ bluesky: { on: true }, mastodon: { trustedOnly: true, mute: ['spam', 'ads'] } })
    expect(f.feed().on).toBe(true)
    expect(() => f.by.feed_source_toggle.run({ id: 'myspace', on: true })).toThrow(/source/)
    expect(() => f.by.feed_source_toggle.run({ on: true })).toThrow(/id/)
  })
  it('feed_algorithm_set stores weights (0..1) and a per-source weight; the answer carries the explanation parts', () => {
    const f = fixture()
    const out = f.by.feed_algorithm_set.run({ recency: 0.2, trust: 0.8, source: 0, perSource: { bluesky: 0.7 } })
    expect(out.algo).toMatchObject({ recency: 0.2, trust: 0.8, source: 0, perSource: { bluesky: 0.7 } })
    expect(out.parts[0]).toEqual({ key: 'trust', level: 'high' })
    expect(f.feed().algo).toMatchObject({ trust: 0.8 })
    expect(() => f.by.feed_algorithm_set.run({ recency: 'lots' })).toThrow(/number/)
  })
  it('feed_no_public_read_set is the separate "Never read public content" switch', () => {
    const f = fixture()
    expect(f.by.feed_no_public_read_set.run({ on: true })).toMatchObject({ noPublicRead: true })
    expect(f.feed().noPublicRead).toBe(true)
    f.by.feed_no_public_read_set.run({ on: false })
    expect(f.feed().noPublicRead).toBeUndefined()
    expect(() => f.by.feed_no_public_read_set.run({})).toThrow(/on/)
  })
  it('feed_publish_target_set stores the preference only; posting there stays off', () => {
    const f = fixture()
    expect(f.by.feed_publish_target_set.run({ target: 'pixelfed' })).toMatchObject({ target: 'pixelfed', posting: false })
    expect(f.feed().publishTarget).toBe('pixelfed')
    expect(() => f.by.feed_publish_target_set.run({ target: 'myspace' })).toThrow(/target/)
  })
})
