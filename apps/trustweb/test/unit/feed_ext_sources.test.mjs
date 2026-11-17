// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c feed-ext (ι + κ): followed Bluesky / PeerTube / Threads / Bridgy Fed accounts, how each is read, when, and how its posts rank and filter. */
import { addExtFollow, due, EXT_TTL_MS, extFeedPosts, extKey, extPosts, extSourceId, parseExtFollow, RATE_BACKOFF_MS, readExt, readPlan, removeExtFollow } from '../../src/feed_ext_sources.ts'
import { filterBySources, rankPosts, sourceIdOf, sourceOn, ALGO_DEFAULT } from '../../src/feed_sources_page.ts'

describe('parseExtFollow', () => {
  it.each([
    ['bluesky', '@Alice.bsky.social', { kind: 'bluesky', handle: 'alice.bsky.social' }],
    ['peertube', '@garden@tube.example.org', { kind: 'peertube', handle: 'garden@tube.example.org' }],
    ['peertube', 'https://tube.example.org/a/garden', { kind: 'peertube', handle: 'garden@tube.example.org' }],
    ['peertube', 'https://tube.example.org/accounts/garden/videos', { kind: 'peertube', handle: 'garden@tube.example.org' }],
    ['threads', 'https://www.threads.net/@zuck', { kind: 'threads', handle: '@zuck@threads.net' }],
    ['bridgy', 'alice.bsky.social', { kind: 'bridgy', handle: '@alice.bsky.social@bsky.brid.gy' }],
    ['bridgy', 'https://example.org/blog', { kind: 'bridgy', handle: '@example.org@web.brid.gy' }],
    ['bridgy', '@example.org@web.brid.gy', { kind: 'bridgy', handle: '@example.org@web.brid.gy' }],
  ])('%s %j', (kind, input, want) => { expect(parseExtFollow(kind, input)).toEqual(want) })
  it.each([['bluesky', 'alice'], ['peertube', 'garden'], ['peertube', '@garden@localhost'], ['threads', '@a@mastodon.social'], ['bridgy', ''], ['myspace', 'tom']])('refuses %s %j', (kind, input) => { expect(parseExtFollow(kind, input)).toBeNull() })
  it('local test instances only where allowed', () => {
    expect(parseExtFollow('peertube', 'garden@127.0.0.1:9000')).toBeNull()
    expect(parseExtFollow('peertube', 'garden@127.0.0.1:9000', true)).toEqual({ kind: 'peertube', handle: 'garden@127.0.0.1:9000' })
  })
})

describe('add, remove', () => {
  it('adds once, switches its source on (an explicit follow), keeps the person it belongs to', () => {
    const f = {}
    const bsky = parseExtFollow('bluesky', 'alice.bsky.social')
    expect(sourceOn(f, 'bluesky')).toBe(false)
    expect(addExtFollow(f, { ...bsky, personId: 'p1' })).toBe(true)
    expect(addExtFollow(f, bsky)).toBe(false)
    expect(f.extFollows).toEqual([{ kind: 'bluesky', handle: 'alice.bsky.social', personId: 'p1' }])
    expect(sourceOn(f, 'bluesky')).toBe(true)
    expect(extKey(f.extFollows[0])).toBe('bluesky:alice.bsky.social')
    expect(removeExtFollow(f, 'bluesky:alice.bsky.social')).toBe(true)
    expect(removeExtFollow(f, 'bluesky:alice.bsky.social')).toBe(false)
    expect(f.extFollows).toBeUndefined()
  })
})

describe('readPlan and source ids', () => {
  it('Bluesky and Threads/Bridgy through the public AppView, PeerTube through its instance', () => {
    expect(readPlan({ kind: 'bluesky', handle: 'alice.bsky.social' })).toEqual({ via: 'bluesky', actor: 'alice.bsky.social' })
    expect(readPlan({ kind: 'peertube', handle: 'garden@tube.example.org' })).toEqual({ via: 'peertube', host: 'tube.example.org', name: 'garden' })
    expect(readPlan({ kind: 'threads', handle: '@zuck@threads.net' })).toEqual({ via: 'bluesky', actor: 'zuck.threads.net.ap.brid.gy' })
    expect(readPlan({ kind: 'bridgy', handle: '@alice.bsky.social@bsky.brid.gy' })).toEqual({ via: 'bluesky', actor: 'alice.bsky.social' })
    expect(readPlan({ kind: 'bridgy', handle: '@example.org@web.brid.gy' })).toEqual({ via: 'bluesky', actor: 'example.org.web.brid.gy' })
  })
  it('each follow filters and ranks under the network its posts come from', () => {
    expect(['bluesky', 'peertube', 'threads'].map((kind) => extSourceId({ kind, handle: 'x' }))).toEqual(['bluesky', 'peertube', 'threads'])
    expect(extSourceId({ kind: 'bridgy', handle: '@a.bsky.social@bsky.brid.gy' })).toBe('bluesky')
    expect(extSourceId({ kind: 'bridgy', handle: '@example.org@web.brid.gy' })).toBe('rss')
  })
})

describe('due: only on open or refresh, never hammering', () => {
  const NOW = 1_000_000_000
  it('never read: due; fresh: not; stale: due; an explicit refresh skips the wait', () => {
    expect(due(undefined, NOW, false)).toBe(true)
    expect(due({ at: NOW - 1000 }, NOW, false)).toBe(false)
    expect(due({ at: NOW - EXT_TTL_MS - 1 }, NOW, false)).toBe(true)
    expect(due({ at: NOW - 1000 }, NOW, true)).toBe(true)
  })
  it('after a rate limit nobody asks again before the backoff, not even a refresh', () => {
    expect(due({ at: NOW - 1000, problem: 'rate-limited' }, NOW, true)).toBe(false)
    expect(due({ at: NOW - RATE_BACKOFF_MS - 1, problem: 'rate-limited' }, NOW, false)).toBe(true)
  })
})

describe('readExt: one follow read through its reader (fetch injected)', () => {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
  it('Threads asks the Bluesky AppView for the Bridgy account', async () => {
    const urls = []
    const got = await readExt({ kind: 'threads', handle: '@zuck@threads.net' }, async (u) => { urls.push(u); return json({ feed: [] }) })
    expect(urls[0]).toContain('actor=zuck.threads.net.ap.brid.gy')
    expect(got).toEqual([])
  })
  it('PeerTube asks the instance', async () => {
    const urls = []
    await readExt({ kind: 'peertube', handle: 'garden@tube.example.org' }, async (u) => { urls.push(u); return json({ total: 0, data: [] }) })
    expect(urls[0]).toMatch(/^https:\/\/tube\.example\.org\/api\/v1\/accounts\/garden\/videos/)
  })
  it('a problem is passed on', async () => {
    expect(await readExt({ kind: 'bluesky', handle: 'alice.bsky.social' }, async () => json({}, 429))).toBe('rate-limited')
  })
})

describe('extPosts in the Feed: filters, trust, ranking', () => {
  const items = [
    { id: 'at://1', at: 2000, text: 'garden news', url: 'https://bsky.app/profile/a/post/1', who: 'Alice', handle: '@alice.bsky.social', card: { url: 'https://example.org/', title: 'Example' }, imageUrl: 'https://cdn.bsky.app/x.jpg' },
    { id: 'at://2', at: 1000, text: 'buy crypto now', url: 'https://bsky.app/profile/a/post/2', who: 'Alice', repostBy: 'Bob' },
  ]
  it('posts carry their source, the person, the link; pictures only where switched on; a link card stays text', () => {
    const posts = extPosts({ kind: 'bluesky', handle: 'alice.bsky.social', personId: 'p1' }, items, false)
    expect(posts[0]).toMatchObject({ id: 'ext:bluesky:alice.bsky.social:at://1', kind: 'follow', src: 'bluesky', personId: 'p1', who: 'Alice', handle: '@alice.bsky.social', open: { kind: 'url', url: 'https://bsky.app/profile/a/post/1' }, linkHost: 'example.org' })
    expect(posts[0].text).toBe('garden news\nExample https://example.org/')
    expect(posts[0].imageUrl).toBeUndefined()
    expect(posts[1].boostedBy).toBe('Bob')
    expect(extPosts({ kind: 'bluesky', handle: 'alice.bsky.social' }, items, true)[0].imageUrl).toBe('https://cdn.bsky.app/x.jpg')
    expect(sourceIdOf(posts[0])).toBe('bluesky')
  })
  it('the Sources page filters apply: source off, mute, trusted only, never read public content', () => {
    const posts = extPosts({ kind: 'bluesky', handle: 'alice.bsky.social', personId: 'p1' }, items, false)
    const trusted = () => true
    expect(filterBySources(posts, {}, trusted)).toEqual([])   // Bluesky is off by default
    const on = { sources: { bluesky: { on: true } } }
    expect(filterBySources(posts, on, trusted)).toHaveLength(2)
    expect(filterBySources(posts, { sources: { bluesky: { on: true, mute: ['crypto'] } } }, trusted).map((p) => p.text)).toEqual([posts[0].text])
    expect(filterBySources(posts, { sources: { bluesky: { on: true, trustedOnly: true } } }, () => false)).toEqual([])
    expect(filterBySources(posts, { ...on, noPublicRead: true }, trusted)).toEqual([])
  })
  it('a per-source weight moves Bluesky posts in the ranking', () => {
    const bsky = extPosts({ kind: 'bluesky', handle: 'a.bsky.social' }, [{ id: '1', at: 1000, text: 'b', url: 'https://bsky.app/x', who: 'A' }], false)
    const tube = extPosts({ kind: 'peertube', handle: 'g@tube.example.org' }, [{ id: '2', at: 1000, text: 'p', url: 'https://tube.example.org/w/x', who: 'G' }], false)
    const rank = (per) => rankPosts([...tube, ...bsky], { ...ALGO_DEFAULT, perSource: per }, 1000, () => false).map((p) => p.src)
    expect(rank({ bluesky: 1, peertube: 0 })).toEqual(['bluesky', 'peertube'])
    expect(rank({ bluesky: 0, peertube: 1 })).toEqual(['peertube', 'bluesky'])
  })
})

describe('extFeedPosts: several follows, one post once', () => {
  it('a post reached through two follows (Bluesky and its Bridgy account) shows once, under the first follow', () => {
    const item = { id: 'at://did:plc:x/app.bsky.feed.post/1', at: 1, text: 't', url: 'https://bsky.app/x', who: 'A' }
    const posts = extFeedPosts([
      { follow: { kind: 'bluesky', handle: 'a.bsky.social' }, items: [item] },
      { follow: { kind: 'bridgy', handle: '@a.bsky.social@bsky.brid.gy' }, items: [item, { ...item, id: 'at://did:plc:x/app.bsky.feed.post/2' }] },
    ], false)
    expect(posts.map((p) => p.id)).toEqual(['ext:bluesky:a.bsky.social:at://did:plc:x/app.bsky.feed.post/1', 'ext:bridgy:@a.bsky.social@bsky.brid.gy:at://did:plc:x/app.bsky.feed.post/2'])
  })
})
