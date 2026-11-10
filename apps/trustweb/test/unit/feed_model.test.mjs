// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events: the pure post model and link cards of the Feed view (src/ext/feed/feed_model.ts). */
import { parseFeed, mergeFeed, firstLink, linkCard, composePost, buildTimeline, ZONES_OFFERED, zoneValid, parsePreview } from '../../src/ext/feed/feed_model.ts'
import { mergeExtData, EXT_DATA_MERGERS } from '../../src/ext/ext_data.ts'

const TAGS = [{ id: 'iyg', colour: '#1565c0', label: 'IYG', community: true }]
const base = () => ({ me: { id: 'me', displayName: 'Ana' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })

describe('link cards', () => {
  it('finds the first http(s) link and drops trailing punctuation', () => {
    expect(firstLink('see https://x.com/ana/status/42, great')).toBe('https://x.com/ana/status/42')
    expect(firstLink('nothing here')).toBeNull()
    expect(firstLink('javascript:alert(1) ftp://x.org')).toBeNull()
  })
  it('names the platform and the author from the path (X)', () => {
    const c = linkCard('https://twitter.com/ana/status/1234567?s=20&utm_source=x')
    expect(c).toMatchObject({ host: 'twitter.com', platform: 'X', handle: '@ana', title: 'Post by @ana' })
    expect(c.href).toBe('https://twitter.com/ana/status/1234567')
  })
  it('reads a Mastodon-style @user path on any host', () => {
    const c = linkCard('https://mastodon.social/@ana/1100022')
    expect(c).toMatchObject({ host: 'mastodon.social', platform: 'Mastodon', handle: '@ana@mastodon.social', title: 'Post by @ana@mastodon.social' })
  })
  it('handles Facebook, LinkedIn, Bluesky and Instagram hosts', () => {
    expect(linkCard('https://www.facebook.com/groups/iyg/posts/9')).toMatchObject({ host: 'facebook.com', platform: 'Facebook', title: 'groups › iyg › posts › 9' })
    expect(linkCard('https://www.linkedin.com/posts/ana-x_climate-garden-share-123')).toMatchObject({ platform: 'LinkedIn', title: 'ana x climate garden share 123' })
    expect(linkCard('https://bsky.app/profile/ana.bsky.social/post/3k')).toMatchObject({ platform: 'Bluesky', handle: '@ana.bsky.social' })
    expect(linkCard('https://www.instagram.com/p/Cx9/?igshid=abc').href).toBe('https://www.instagram.com/p/Cx9/')
  })
  it('falls back to the last path words, then the host, for any other site', () => {
    expect(linkCard('https://example.org/news/the-garden-opens-today')).toEqual({ href: 'https://example.org/news/the-garden-opens-today', host: 'example.org', title: 'the garden opens today' })
    expect(linkCard('https://example.org/')).toMatchObject({ title: 'example.org' })
  })
  it('refuses anything but http(s) and links with credentials', () => {
    expect(linkCard('javascript:alert(1)')).toBeNull()
    expect(linkCard('https://user:pw@evil.example/x')).toBeNull()
    expect(linkCard('not a url')).toBeNull()
  })
})

describe('feed data', () => {
  it('parses junk to {} and keeps only valid posts', () => {
    expect(parseFeed(7)).toEqual({})
    const d = parseFeed({ preview: true, posts: [{ id: 'a', text: 'hi', zone: 'ring:close', at: 3 }, { id: 'b', text: 5 }, null], extra: 1 })
    expect(d).toEqual({ preview: true, posts: [{ id: 'a', text: 'hi', zone: 'ring:close', at: 3 }] })
  })
  it('merges two devices: posts join by id, the preview switch from the incoming side', () => {
    const m = mergeFeed({ posts: [{ id: 'a', text: 'x', zone: 'ring:close', at: 1 }] }, { preview: true, posts: [{ id: 'b', text: 'y', zone: 'ring:friend', at: 2 }, { id: 'a', text: 'x', zone: 'ring:close', at: 1 }] })
    expect(m.posts.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(m.preview).toBe(true)
  })
  it('rides the extData merge once the module registered its rule', () => {
    EXT_DATA_MERGERS.set('feed-view', mergeFeed)
    const out = mergeExtData({ 'feed-view': { posts: [{ id: 'a', text: 'x', zone: 'ring:close', at: 1 }] } }, { 'feed-view': { posts: [{ id: 'b', text: 'y', zone: 'ring:close', at: 2 }] } })
    expect(out['feed-view'].posts).toHaveLength(2)
  })
})

describe('composer', () => {
  it('offers the three trust zones, narrowest first, then the colour tags; validates a zone', () => {
    expect(ZONES_OFFERED(TAGS)).toEqual(['ring:closest', 'ring:close', 'ring:friend', 'tag:iyg'])
    expect(zoneValid('ring:close', TAGS)).toBe(true)
    expect(zoneValid('tag:iyg', TAGS)).toBe(true)
    expect(zoneValid('tag:nope', TAGS)).toBe(false)
    expect(zoneValid('public', TAGS)).toBe(false)
  })
  it('keeps a zone post on this phone and puts it in the timeline with its audience', () => {
    const s = base()
    const d = {}
    expect(composePost(s, d, { text: '  hello https://x.com/ana/status/1  ', zone: 'ring:close' }, TAGS, 1000)).toBe('own')
    expect(d.posts).toHaveLength(1)
    const t = buildTimeline(s, d, TAGS, (z) => z)
    expect(t[0]).toMatchObject({ who: null, text: 'hello https://x.com/ana/status/1', zone: 'ring:close', unsent: true })
    expect(t[0].link.platform).toBe('X')
  })
  it('refuses empty text and an unknown zone', () => {
    expect(composePost(base(), {}, { text: '   ', zone: 'ring:close' }, TAGS, 1)).toBeNull()
    expect(composePost(base(), {}, { text: 'hi', zone: 'tag:nope' }, TAGS, 1)).toBeNull()
  })
  it('sends a post to a tag I joined through the existing group post (no second copy)', () => {
    const s = base()
    s.zoneTags = { self: { ids: ['iyg'], stamp: 1 } }
    const d = {}
    expect(composePost(s, d, { text: 'garden day', zone: 'tag:iyg' }, TAGS, 5000)).toBe('group')
    expect(d.posts ?? []).toHaveLength(0)
    expect(s.groupPosts).toHaveLength(1)
    const t = buildTimeline(s, d, TAGS, (z) => z)
    expect(t.filter((p) => p.text === 'garden day')).toHaveLength(1)
    expect(t[0].audience).toBe('IYG')
  })
  it('a tag I did not join stays a post on this phone', () => {
    const d = {}
    expect(composePost(base(), d, { text: 'hi', zone: 'tag:iyg' }, TAGS, 1)).toBe('own')
    expect(d.posts[0].zone).toBe('tag:iyg')
  })
})

describe('timeline', () => {
  it('lists my posts and the existing feed newest first', () => {
    const s = base()
    s.coNotes = [{ id: 'n1', title: 'Shared note', people: [{ name: 'Ben' }], seen: { a: 500 } }]
    const d = { posts: [{ id: 'p1', text: 'mine', zone: 'ring:friend', at: 900 }] }
    const t = buildTimeline(s, d, TAGS, (z) => z)
    expect(t.map((p) => p.text)).toEqual(['mine', 'Shared note'])
  })
  it('gives text without a link no card', () => {
    const t = buildTimeline(base(), { posts: [{ id: 'p', text: 'plain', zone: 'ring:close', at: 1 }] }, TAGS, (z) => z)
    expect(t[0].link).toBeNull()
  })
})

describe('host preview (optional)', () => {
  it('reads a title from the host answer, clipped, and nothing else', () => {
    expect(parsePreview({ title: '  Garden day  ', html: '<script>', x: 1 })).toEqual({ title: 'Garden day' })
    expect(parsePreview({ title: 'x'.repeat(300) }).title).toHaveLength(120)
  })
  it('gives null for an answer without a usable title', () => {
    expect(parsePreview(null)).toBeNull()
    expect(parsePreview({ title: '' })).toBeNull()
    expect(parsePreview({ title: 4 })).toBeNull()
  })
})
