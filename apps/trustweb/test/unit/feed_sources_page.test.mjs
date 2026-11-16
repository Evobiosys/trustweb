// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-sources (β): the Sources page model: sections, per-source filters, the trusted-only read rule, the transparent ranking, the publish target. Fake data only. */
import { MASTODON_POST_ENABLED } from '../../src/mastodon_default.ts'
import { ALGO_DEFAULT, algoOf, algoParts, FEED_EXTERNAL_PUBLISH_ENABLED, filterBySources, publicReadAllowed, PUBLISH_TARGETS, rankPosts, setAlgo, setNoPublicRead, setPublishTarget, setSource, sourceIdOf, sourceOn, SOURCES } from '../../src/feed_sources_page.ts'

const NOW = 1_760_000_000_000
const H = 3_600_000
const post = (id, kind, o = {}) => ({ id, kind, at: NOW - H, text: `text ${id}`, ...o })
const trusted = (p) => p.personId === 'ada' || p.kind === 'follow'

describe('sections and defaults', () => {
  it('has the three sections, every id once; techno-feudal is discouraged and off by default', () => {
    expect([...new Set(SOURCES.map((s) => s.group))]).toEqual(['techno', 'alt', 'open'])
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length)
    expect(SOURCES.filter((s) => s.group === 'techno').map((s) => s.id)).toEqual(['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'])
    for (const s of SOURCES.filter((s) => s.group === 'techno')) { expect(s.discouraged).toBe(true); expect(sourceOn({}, s.id)).toBe(false) }
    expect(SOURCES.filter((s) => s.group === 'alt').map((s) => s.id)).toEqual(['bluesky', 'vimeo', 'substack', 'threads'])
    expect(SOURCES.filter((s) => s.group === 'open').map((s) => s.id)).toEqual(['mastodon', 'pixelfed', 'peertube', 'lemmy', 'friendica', 'rss', 'nostr'])
  })
  it('setSource stores only what differs from the default', () => {
    const f = {}
    setSource(f, 'bluesky', { on: true })
    expect(sourceOn(f, 'bluesky')).toBe(true)
    setSource(f, 'bluesky', { on: false })
    expect(f.sources).toBeUndefined()
    setSource(f, 'mastodon', { trustedOnly: true, mute: ['spam', ' ', 'ads'] })
    expect(f.sources.mastodon).toEqual({ trustedOnly: true, mute: ['spam', 'ads'] })
    expect(() => setSource(f, 'nope', { on: true })).toThrow(/source/)
  })
})

describe('the read rule (β)', () => {
  const posts = [post('a', 'remote', { personId: 'ada' }), post('b', 'remote', { personId: 'ben' }), post('c', 'remote'), post('d', 'follow'), post('e', 'follow', { news: true }), post('f', 'social'), post('g', 'group')]
  const ids = (l) => l.map((p) => p.id)
  it('without filters nothing is dropped', () => expect(ids(filterBySources(posts, {}, trusted))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']))
  it('maps a post to its source; web and own posts have none', () => {
    expect([sourceIdOf(posts[0]), sourceIdOf(posts[3]), sourceIdOf(posts[4]), sourceIdOf(posts[5]), sourceIdOf(posts[6])]).toEqual(['mastodon', 'mastodon', 'rss', undefined, 'nostr'])
  })
  it('trustedOnly still reads, and shows only posts by trusted people', () => {
    const f = {}
    setSource(f, 'mastodon', { trustedOnly: true })
    expect(publicReadAllowed(f)).toBe(true)
    expect(ids(filterBySources(posts, f, trusted))).toEqual(['a', 'd', 'e', 'f', 'g'])
  })
  it('publicAllowed=false drops that source\'s public posts; off drops the source', () => {
    const f = {}
    setSource(f, 'mastodon', { publicAllowed: false })
    expect(ids(filterBySources(posts, f, trusted))).toEqual(['e', 'f', 'g'])
    setSource(f, 'rss', { on: false })
    expect(ids(filterBySources(posts, f, trusted))).toEqual(['f', 'g'])
  })
  it('noPublicRead: no public read at all (the view fetches nothing), and any public post is dropped', () => {
    const f = {}
    setNoPublicRead(f, true)
    expect(publicReadAllowed(f)).toBe(false)
    expect(ids(filterBySources(posts, f, trusted))).toEqual(['f', 'g'])
    setNoPublicRead(f, false)
    expect(f.noPublicRead).toBeUndefined()
  })
  it('mute words drop posts that contain one, any case', () => {
    const f = {}
    setSource(f, 'mastodon', { mute: ['TEXT a'] })
    expect(ids(filterBySources(posts, f, trusted))).not.toContain('a')
  })
  it('never publishes: filters make no network call, and posting stays switched off', () => {
    const calls = []
    const spy = globalThis.fetch
    globalThis.fetch = (...a) => { calls.push(a); return Promise.reject(new Error('no')) }
    try {
      const f = {}
      for (const id of SOURCES.map((s) => s.id)) setSource(f, id, { on: true, trustedOnly: true, publicAllowed: true })
      setNoPublicRead(f, false)
      filterBySources(posts, f, trusted); rankPosts(posts, algoOf(f), NOW, trusted)
    } finally { globalThis.fetch = spy }
    expect(calls).toEqual([])
    expect(MASTODON_POST_ENABLED).toBe(false)
    expect(FEED_EXTERNAL_PUBLISH_ENABLED).toBe(false)
  })
})

describe('the transparent ranking', () => {
  it('defaults to 0.6 / 0.3 / 0.1', () => { expect(ALGO_DEFAULT).toMatchObject({ recency: 0.6, trust: 0.3, source: 0.1 }); expect(algoOf({})).toMatchObject(ALGO_DEFAULT) })
  it('recency only: newest first', () => {
    const l = [post('old', 'remote', { at: NOW - 48 * H }), post('new', 'remote', { at: NOW - H })]
    expect(rankPosts(l, { recency: 1, trust: 0, source: 0 }, NOW, trusted).map((p) => p.id)).toEqual(['new', 'old'])
  })
  it('trust lifts a trusted post over a slightly newer stranger', () => {
    const l = [post('stranger', 'remote', { at: NOW - H }), post('ada', 'remote', { personId: 'ada', at: NOW - 3 * H })]
    expect(rankPosts(l, { recency: 0.6, trust: 0.3, source: 0.1 }, NOW, trusted)[0].id).toBe('ada')
    expect(rankPosts(l, { recency: 1, trust: 0, source: 0 }, NOW, trusted)[0].id).toBe('stranger')
  })
  it('a per-source weight lifts that source', () => {
    const l = [post('m', 'remote', { at: NOW - H }), post('r', 'follow', { news: true, at: NOW - H })]
    expect(rankPosts(l, { recency: 0, trust: 0, source: 1, perSource: { rss: 1, mastodon: 0 } }, NOW, () => false)[0].id).toBe('r')
  })
  it('does not change its input', () => {
    const l = [post('a', 'remote', { at: 1 }), post('b', 'remote', { at: 2 })]
    rankPosts(l, ALGO_DEFAULT, NOW, trusted)
    expect(l.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('setAlgo clamps to 0..1, keeps per-source weights, and stores nothing at the default', () => {
    const f = {}
    setAlgo(f, { recency: 5, trust: -1 })
    expect(algoOf(f)).toMatchObject({ recency: 1, trust: 0, source: 0.1 })
    setAlgo(f, { perSource: { bluesky: 0.9 } })
    expect(algoOf(f).perSource).toEqual({ bluesky: 0.9 })
    setAlgo(f, { recency: 0.6, trust: 0.3, perSource: {} })
    expect(f.algo).toBeUndefined()
    expect(() => setAlgo(f, { perSource: { nope: 1 } })).toThrow(/source/)
  })
  it('algoParts orders the three by weight and marks a near-zero one as ignored', () => {
    expect(algoParts({ recency: 0.6, trust: 0.3, source: 0.1 }).map((p) => p.key)).toEqual(['recency', 'trust', 'source'])
    expect(algoParts({ recency: 0.1, trust: 0.9, source: 0 })).toEqual([{ key: 'trust', level: 'high' }, { key: 'recency', level: 'low' }])
    expect(algoParts({ recency: 0, trust: 0, source: 0 })).toEqual([])
  })
})

describe('publish target', () => {
  it('defaults to the fediverse; X and LinkedIn are listed as discouraged; storing a choice sends nothing', () => {
    expect(PUBLISH_TARGETS.map((t) => t.id)).toEqual(['fediverse', 'bluesky', 'pixelfed', 'vimeo', 'x', 'linkedin'])
    expect(PUBLISH_TARGETS.filter((t) => t.discouraged).map((t) => t.id)).toEqual(['x', 'linkedin'])
    const f = {}
    expect(setPublishTarget(f, 'bluesky')).toBe('bluesky')
    expect(f.publishTarget).toBe('bluesky')
    setPublishTarget(f, 'fediverse')
    expect(f.publishTarget).toBeUndefined()
    expect(() => setPublishTarget(f, 'myspace')).toThrow(/target/)
  })
})
