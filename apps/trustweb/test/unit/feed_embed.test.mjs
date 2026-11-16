// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-embed: post links -> embeds. No network: fetch is injected. */
import { addEmbed, EMBED_MAX, embedPosts, fetchEmbed, parsePostLink } from '../../src/feed_embed.ts'

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const mock = (routes) => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); const r = routes(url); if (!r) throw new Error('no route'); return r }
  return { f, calls }
}

describe('parsePostLink', () => {
  it.each([
    ['https://mastodon.social/@alice/111222333', { network: 'mastodon', host: 'mastodon.social', id: '111222333' }],
    ['https://mastodon.social/@alice@other.example/111', { network: 'mastodon', host: 'mastodon.social', id: '111' }],
    ['https://mastodon.social/users/alice/statuses/123', { network: 'mastodon', host: 'mastodon.social', id: '123' }],
    ['https://pixelfed.social/p/alice/4567', { network: 'pixelfed', host: 'pixelfed.social', id: '4567' }],
    ['https://pixelfed.social/i/web/post/4567', { network: 'pixelfed', host: 'pixelfed.social', id: '4567' }],
    ['https://tube.videos.org/w/abcDEF123xyz', { network: 'peertube', host: 'tube.videos.org', id: 'abcDEF123xyz' }],
    ['https://tube.videos.org/videos/watch/0b2c1e30-1111-4222-8333-444455556666', { network: 'peertube', host: 'tube.videos.org', id: '0b2c1e30-1111-4222-8333-444455556666' }],
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc', { network: 'bluesky', host: 'bsky.app', handle: 'alice.bsky.social', rkey: '3kabc' }],
    ['https://bsky.app/profile/did:plc:abc123/post/3kabc', { network: 'bluesky', host: 'bsky.app', handle: 'did:plc:abc123', rkey: '3kabc' }],
    ['https://vimeo.com/123456789', { network: 'vimeo', host: 'vimeo.com', id: '123456789' }],
    ['https://player.vimeo.com/video/123456789', { network: 'vimeo', host: 'vimeo.com', id: '123456789' }],
    ['https://x.com/someone/status/1', { network: 'x', host: 'x.com' }],
    ['https://twitter.com/someone/status/1', { network: 'x', host: 'twitter.com' }],
    ['https://www.linkedin.com/posts/someone_abc', { network: 'linkedin', host: 'www.linkedin.com' }],
    ['https://example.org/some/page', { network: 'other', host: 'example.org' }],
  ])('%s', (url, want) => { expect(parsePostLink(url)).toMatchObject(want) })

  it('trims, and keeps the url', () => { expect(parsePostLink('  https://vimeo.com/5  ')).toMatchObject({ url: 'https://vimeo.com/5' }) })
  it.each(['', 'hello', 'http://mastodon.social/@a/1', 'https://127.0.0.1/@a/1', 'https://localhost/@a/1', 'https://user:pw@mastodon.social/@a/1', 'javascript:alert(1)', 'https://a.example/x y', 'two https://a.example/ links'])('refuses %j', (s) => { expect(parsePostLink(s)).toBeNull() })
})

describe('fetchEmbed', () => {
  const NOW = Date.parse('2026-11-16T10:00:00Z')
  it('Mastodon: one GET to the post\'s own host, plain text, no remote HTML kept', async () => {
    const m = mock(() => json({ id: '111', visibility: 'public', created_at: '2026-11-15T08:00:00.000Z', url: 'https://mastodon.social/@alice/111', content: '<p>Hello <b>world</b><script>alert(1)</script></p><p>2nd &amp; last</p>', account: { username: 'alice', acct: 'alice', display_name: 'Alice A' }, media_attachments: [{ type: 'image', preview_url: 'https://files.mastodon.social/p.png' }] }))
    const e = await fetchEmbed(parsePostLink('https://mastodon.social/@alice/111'), m.f, NOW)
    expect(m.calls.map((c) => c.url)).toEqual(['https://mastodon.social/api/v1/statuses/111'])
    expect(m.calls[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(e).toMatchObject({ who: 'Alice A', handle: '@alice@mastodon.social', text: 'Hello world\n\n2nd & last', imageUrl: 'https://files.mastodon.social/p.png', url: 'https://mastodon.social/@alice/111', linkHost: 'mastodon.social' })
    expect(e.at).toBe(Date.parse('2026-11-15T08:00:00.000Z'))
    expect(e.card).toBeUndefined()
    expect(e.text).not.toMatch(/alert|<|script/)
  })
  it('Mastodon: a remote account keeps its own host in the handle; falls back to the user name', async () => {
    const m = mock(() => json({ id: '1', created_at: '2026-11-15T08:00:00Z', content: '<p>x</p>', account: { username: 'bob', acct: 'bob@other.example', display_name: '' } }))
    expect(await fetchEmbed(parsePostLink('https://mastodon.social/@bob@other.example/1'), m.f, NOW)).toMatchObject({ who: 'bob', handle: '@bob@other.example' })
  })
  it('Mastodon: a private post, a missing post or an unreachable host becomes a link card with the domain', async () => {
    for (const r of [() => json({ id: '1', visibility: 'private', created_at: '2026-11-15T08:00:00Z', content: 'x' }), () => json({}, 404), () => null, () => json([])]) {
      const e = await fetchEmbed(parsePostLink('https://mastodon.social/@alice/1'), mock(r).f, NOW)
      expect(e).toMatchObject({ card: true, who: 'mastodon.social', url: 'https://mastodon.social/@alice/1', linkHost: 'mastodon.social', at: NOW })
    }
  })
  it('Bluesky: resolves a handle, reads the thread from public.api.bsky.app only', async () => {
    const m = mock((u) => u.includes('resolveHandle') ? json({ did: 'did:plc:zzz' }) : json({ thread: { post: { author: { displayName: 'Ann', handle: 'ann.bsky.social' }, record: { text: 'Hi sky', createdAt: '2026-11-14T10:00:00.000Z' }, embed: { images: [{ thumb: 'https://cdn.bsky.app/img/t.jpg' }] } } } }))
    const e = await fetchEmbed(parsePostLink('https://bsky.app/profile/ann.bsky.social/post/3kabc'), m.f, NOW)
    expect(m.calls[0].url).toBe('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=ann.bsky.social')
    expect(m.calls[1].url).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=' + encodeURIComponent('at://did:plc:zzz/app.bsky.feed.post/3kabc') + '&depth=0&parentHeight=0')
    expect(m.calls.every((c) => c.url.startsWith('https://public.api.bsky.app/'))).toBe(true)
    expect(e).toMatchObject({ who: 'Ann', handle: '@ann.bsky.social', text: 'Hi sky', imageUrl: 'https://cdn.bsky.app/img/t.jpg', url: 'https://bsky.app/profile/ann.bsky.social/post/3kabc', linkHost: 'bsky.app' })
  })
  it('Bluesky: a DID needs no resolve call; a failure is a link card', async () => {
    const m = mock(() => json({ thread: { post: { author: { handle: 'a.b' }, record: { text: 'T', createdAt: '2026-11-14T10:00:00Z' } } } }))
    expect(await fetchEmbed(parsePostLink('https://bsky.app/profile/did:plc:abc/post/3k'), m.f, NOW)).toMatchObject({ who: 'a.b', text: 'T' })
    expect(m.calls).toHaveLength(1)
    expect(await fetchEmbed(parsePostLink('https://bsky.app/profile/did:plc:abc/post/3k'), mock(() => json({}, 400)).f, NOW)).toMatchObject({ card: true, linkHost: 'bsky.app' })
  })
  it('PeerTube and Vimeo: oEmbed title + thumbnail, never the player html', async () => {
    const o = { title: 'A talk', author_name: 'Tuber', thumbnail_url: 'https://tube.videos.org/lazy-static/t.jpg', html: '<iframe src="https://evil"></iframe>' }
    const m = mock(() => json(o))
    const e = await fetchEmbed(parsePostLink('https://tube.videos.org/w/abcDEF123xyz'), m.f, NOW)
    expect(m.calls[0].url).toBe('https://tube.videos.org/services/oembed?format=json&url=' + encodeURIComponent('https://tube.videos.org/w/abcDEF123xyz'))
    expect(e).toMatchObject({ who: 'Tuber', text: 'A talk', imageUrl: 'https://tube.videos.org/lazy-static/t.jpg', linkHost: 'tube.videos.org' })
    expect(JSON.stringify(e)).not.toMatch(/iframe|evil/)
    const v = mock(() => json({ ...o, thumbnail_url: 'https://i.vimeocdn.com/v.jpg' }))
    expect(await fetchEmbed(parsePostLink('https://vimeo.com/123456789'), v.f, NOW)).toMatchObject({ who: 'Tuber', text: 'A talk', imageUrl: 'https://i.vimeocdn.com/v.jpg' })
    expect(v.calls[0].url).toBe('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/123456789'))
  })
  it('X, LinkedIn, Pixelfed and other pages: link card, no request at all', async () => {
    for (const u of ['https://x.com/a/status/1', 'https://www.linkedin.com/posts/a_b', 'https://pixelfed.social/p/a/1', 'https://example.org/page']) {
      const m = mock(() => json({}))
      const e = await fetchEmbed(parsePostLink(u), m.f, NOW)
      expect(m.calls).toHaveLength(0)
      expect(e).toMatchObject({ card: true, url: u, linkHost: new URL(u).host, who: new URL(u).host })
    }
  })
  it('an unsafe image address is dropped', async () => {
    const m = mock(() => json({ title: 'T', author_name: 'A', thumbnail_url: 'http://127.0.0.1/x.png' }))
    expect((await fetchEmbed(parsePostLink('https://vimeo.com/1'), m.f, NOW)).imageUrl).toBeUndefined()
  })
})

describe('embeds in the record', () => {
  const rec = (n) => ({ id: `embed:https://a.example/${n}`, who: 'a.example', at: n, text: 't', url: `https://a.example/${n}`, linkHost: 'a.example', card: true })
  it('addEmbed puts the newest first, drops a repeat and caps at 200', () => {
    const s = {}
    expect(addEmbed(s, rec(1))).toBe(true)
    expect(addEmbed(s, rec(1))).toBe(false)
    for (let i = 2; i < EMBED_MAX + 10; i++) addEmbed(s, rec(i))
    expect(s.feedEmbeds).toHaveLength(EMBED_MAX)
    expect(s.feedEmbeds[0].at).toBe(EMBED_MAX + 9)
  })
  it('embedPosts: Remote posts, picture only where pictures are on, open = the original url', () => {
    const r = { ...rec(5), imageUrl: 'https://a.example/i.png', handle: '@a@a.example', card: undefined, who: 'Ann' }
    const [off] = embedPosts([r], false)
    const [on] = embedPosts([r], true)
    expect(off).toMatchObject({ id: r.id, kind: 'remote', who: 'Ann', handle: '@a@a.example', linkHost: 'a.example', dummy: false, open: { kind: 'url', url: r.url } })
    expect(off.imageUrl).toBeUndefined()
    expect(on.imageUrl).toBe('https://a.example/i.png')
  })
})
