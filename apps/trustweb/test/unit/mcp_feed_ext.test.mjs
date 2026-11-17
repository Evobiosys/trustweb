// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c feed-ext, MCP parity (P02): feed_source_add, feed_source_remove, feed_refresh, feed_extension_set, feed_post_read. Dummy data, fetch injected. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const fx = (name) => readFileSync(new URL(`./fixtures/feed_ext/${name}`, import.meta.url), 'utf8')
const reply = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })

function fixture(write = true, route = () => reply('{}'), feed = { on: true }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpfx-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], sameAs: {}, meetings: [], me: { id: 'me', displayName: 'Tester' }, feed }))
  const calls = []
  const tools = allTools({ file, write, now: () => new Date('2026-11-17T10:00:00Z'), embedFetch: async (url, init) => { calls.push(url); return route(url, init) } })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')), calls }
}
const WRITES = ['feed_source_add', 'feed_source_remove', 'feed_extension_set']
const READS = ['feed_refresh', 'feed_post_read']

describe('feed-ext tools', () => {
  it('writes only with writes on, reads always; all listed in MCP_TOOLS with the right flag', () => {
    const ro = Object.keys(fixture(false).by)
    expect(ro.filter((n) => WRITES.includes(n))).toEqual([])
    expect(ro).toEqual(expect.arrayContaining(READS))
    expect(Object.keys(fixture().by)).toEqual(expect.arrayContaining([...WRITES, ...READS]))
    for (const n of WRITES) expect(MCP_TOOLS.find((t) => t.name === n)?.write).toBe(true)
    for (const n of READS) expect(MCP_TOOLS.find((t) => t.name === n)?.write).toBe(false)
  })

  it('feed_source_add: canonical handle, source switched on; Bridgy returns the bridged handle and the opt-in note', () => {
    const f = fixture()
    expect(f.by.feed_source_add.run({ kind: 'bluesky', handle: '@Alice.bsky.social' })).toMatchObject({ source: 'bluesky:alice.bsky.social', added: true, sourceOn: true })
    const b = f.by.feed_source_add.run({ kind: 'bridgy', handle: 'https://example.org' })
    expect(b).toMatchObject({ source: 'bridgy:@example.org@web.brid.gy', bridged: '@example.org@web.brid.gy' })
    expect(b.note).toMatch(/opt/i)
    expect(f.by.feed_source_add.run({ kind: 'bluesky', handle: 'alice.bsky.social' })).toMatchObject({ added: false })
    expect(f.rec().feed.extFollows.map((x) => x.kind)).toEqual(['bluesky', 'bridgy'])
    expect(f.rec().feed.sources).toEqual({ bluesky: { on: true } })
    expect(() => f.by.feed_source_add.run({ kind: 'myspace', handle: 'tom' })).toThrow(/kind/)
    expect(() => f.by.feed_source_add.run({ kind: 'peertube', handle: 'garden' })).toThrow(/address/)
  })

  it('feed_source_remove', () => {
    const f = fixture()
    f.by.feed_source_add.run({ kind: 'threads', handle: 'zuck' })
    expect(f.by.feed_source_remove.run({ source: 'threads:@zuck@threads.net' })).toEqual({ source: 'threads:@zuck@threads.net', removed: true })
    expect(f.rec().feed.extFollows).toBeUndefined()
    expect(f.by.feed_source_remove.run({ source: 'threads:@zuck@threads.net' }).removed).toBe(false)
  })

  it('feed_refresh reads one source (or all) now, stores nothing, and says why not', async () => {
    const f = fixture(true, (url) => (url.includes('getAuthorFeed') ? reply(fx('bluesky_author_feed.json')) : reply(fx('peertube_account_videos.json'))))
    f.by.feed_source_add.run({ kind: 'bluesky', handle: 'alice.test.bsky.social' })
    f.by.feed_source_add.run({ kind: 'peertube', handle: 'garden@tube.test.example.org' })
    const before = JSON.stringify(f.rec())
    const one = await f.by.feed_refresh.run({ source: 'bluesky:alice.test.bsky.social' })
    expect(f.calls).toHaveLength(1)
    expect(one.results[0].posts[0]).toMatchObject({ who: 'Alice Test', url: 'https://bsky.app/profile/alice.test.bsky.social/post/3kaaa111', at: '2026-11-16T09:00:00.000Z' })
    const all = await f.by.feed_refresh.run({ source: 'all' })
    expect(all.results.map((r) => r.source)).toEqual(['bluesky:alice.test.bsky.social', 'peertube:garden@tube.test.example.org'])
    expect(JSON.stringify(f.rec())).toBe(before)
    await expect(f.by.feed_refresh.run({ source: 'bluesky:nobody.bsky.social' })).rejects.toThrow(/no followed source/)
  })

  it('feed_refresh reads nothing under "Never read public content" or for a switched-off source', async () => {
    const f = fixture(true, () => reply(fx('bluesky_author_feed.json')), { on: true, noPublicRead: true, extFollows: [{ kind: 'bluesky', handle: 'a.bsky.social' }, { kind: 'peertube', handle: 'g@tube.example.org' }], sources: { bluesky: { on: true }, peertube: { on: false } } })
    await expect(f.by.feed_refresh.run({ source: 'all' })).rejects.toThrow(/Never read public content/)
    expect(f.calls).toHaveLength(0)
    const g = fixture(true, () => reply(fx('bluesky_author_feed.json')), { on: true, extFollows: [{ kind: 'peertube', handle: 'g@tube.example.org' }], sources: { peertube: { on: false } } })
    expect((await g.by.feed_refresh.run({ source: 'all' })).results[0]).toEqual({ source: 'peertube:g@tube.example.org', problem: 'source-off' })
    expect(g.calls).toHaveLength(0)
  })

  it('feed_extension_set: Phanpy on/off and its address, Bridgy Fed + Threads on/off', () => {
    const f = fixture()
    expect(f.by.feed_extension_set.run({ id: 'phanpy', on: true, url: 'my.phanpy.example.org' })).toEqual({ id: 'phanpy', on: true, url: 'https://my.phanpy.example.org/' })
    expect(f.rec().twSettings.extensions).toEqual({ phanpy: true })
    expect(f.rec().extData.phanpy).toEqual({ url: 'https://my.phanpy.example.org/' })
    expect(f.by.feed_extension_set.run({ id: 'bridges', on: false })).toEqual({ id: 'bridges', on: false })
    expect(f.rec().twSettings.extensions).toEqual({ phanpy: true, bridges: false })
    expect(() => f.by.feed_extension_set.run({ id: 'phanpy', url: 'http://x.example.org' })).toThrow(/https/)
    expect(() => f.by.feed_extension_set.run({ id: 'matrix', on: true })).toThrow(/id/)
  })

  it('feed_post_read: a Bluesky post with its replies, a PeerTube video in full', async () => {
    const f = fixture(false, (url) => (url.includes('resolveHandle') ? reply(JSON.stringify({ did: 'did:plc:testalice234567' })) : url.includes('getPostThread') ? reply(fx('bluesky_post_thread.json')) : reply(fx('peertube_video.json'))))
    const b = await f.by.feed_post_read.run({ url: 'https://bsky.app/profile/alice.test.bsky.social/post/3kaaa111' })
    expect(b.post.text).toBe('Seed swap on Saturday')
    expect(b.replies).toHaveLength(1)
    const v = await f.by.feed_post_read.run({ url: 'https://tube.test.example.org/w/abcDEF123xyz' })
    expect(v.post.text).toContain('The full description')
    await expect(f.by.feed_post_read.run({ url: 'https://x.com/a/status/1' })).rejects.toThrow(/Bluesky or PeerTube/)
  })
})
