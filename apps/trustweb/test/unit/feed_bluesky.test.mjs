// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c feed-ext (κ): the public Bluesky reader. Recorded-shape fixtures (dummy accounts), fetch injected: no network. */
import { readFileSync } from 'node:fs'
import { authorFeedUrl, BSKY_PAGE, fetchAuthorFeed, fetchPostThread, postThreadUrl, postWebUrl, resolveHandle } from '../../src/feed_bluesky.ts'

const fixture = (name) => readFileSync(new URL(`./fixtures/feed_ext/${name}`, import.meta.url), 'utf8')
const mock = (body, status = 200) => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return new Response(body, { status, headers: { 'Content-Type': 'application/json' } }) }
  return { f, calls }
}

describe('urls', () => {
  it('author feed: public AppView, no replies, a page, the cursor when paging', () => {
    expect(authorFeedUrl('alice.test.bsky.social')).toBe(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=alice.test.bsky.social&limit=${BSKY_PAGE}&filter=posts_no_replies`)
    expect(authorFeedUrl('did:plc:testalice234567', '2026-11-12T08:00:00.000Z')).toContain('&cursor=2026-11-12T08%3A00%3A00.000Z')
    expect(BSKY_PAGE).toBeLessThanOrEqual(100)
  })
  it('post thread and the bsky.app link of a post', () => {
    expect(postThreadUrl('at://did:plc:x/app.bsky.feed.post/3k')).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Ax%2Fapp.bsky.feed.post%2F3k&depth=1&parentHeight=0')
    expect(postWebUrl('alice.test.bsky.social', 'at://did:plc:x/app.bsky.feed.post/3kaaa111')).toBe('https://bsky.app/profile/alice.test.bsky.social/post/3kaaa111')
  })
})

describe('fetchAuthorFeed', () => {
  it('one GET, no cookies, no referrer; text + link cards; reposts named; logged-in-only authors and empty posts dropped', async () => {
    const m = mock(fixture('bluesky_author_feed.json'))
    const got = await fetchAuthorFeed('alice.test.bsky.social', m.f)
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' })
    expect(got.cursor).toBe('2026-11-12T08:00:00.000Z')
    expect(got.items.map((i) => i.id)).toEqual(['at://did:plc:testalice234567/app.bsky.feed.post/3kaaa111', 'at://did:plc:testbob2345678/app.bsky.feed.post/3kbbb222', 'at://did:plc:testalice234567/app.bsky.feed.post/3keee555'])
    const [a, b, v] = got.items
    expect(a).toMatchObject({ who: 'Alice Test', handle: '@alice.test.bsky.social', at: Date.parse('2026-11-16T09:00:00.000Z'), url: 'https://bsky.app/profile/alice.test.bsky.social/post/3kaaa111', card: { url: 'https://garden.example.org/swap', title: 'Seed swap' } })
    expect(a.text).not.toMatch(/\u202E/)
    expect(a.text).toContain('Seed swap on Saturday')
    expect(b).toMatchObject({ who: 'bob.test.bsky.social', repostBy: 'Alice Test', imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:testbob2345678/bafkreb@jpeg' })
    expect(v).toMatchObject({ video: true, imageUrl: 'https://video.bsky.app/watch/did/thumbnail.jpg' })
  })
  it('a bad actor asks nothing', async () => {
    const m = mock('{}')
    expect(await fetchAuthorFeed('not a handle', m.f)).toBe('malformed')
    expect(m.calls).toHaveLength(0)
  })
  it('rate limit, not found, garbage: the reason, never a throw', async () => {
    expect(await fetchAuthorFeed('alice.test.bsky.social', mock('', 429).f)).toBe('rate-limited')
    expect(await fetchAuthorFeed('alice.test.bsky.social', mock('', 404).f)).toBe('not-found')
    expect(await fetchAuthorFeed('alice.test.bsky.social', mock('{"feed":"x"}').f)).toBe('malformed')
    expect(await fetchAuthorFeed('alice.test.bsky.social', mock('<html>').f)).toBe('malformed')
    expect(await fetchAuthorFeed('alice.test.bsky.social', async () => { throw new TypeError('offline') })).toBe('unreachable')
  })
})

describe('fetchPostThread', () => {
  it('the post and its direct replies (missing replies skipped)', async () => {
    const m = mock(fixture('bluesky_post_thread.json'))
    const got = await fetchPostThread('at://did:plc:testalice234567/app.bsky.feed.post/3kaaa111', m.f)
    expect(got.post).toMatchObject({ who: 'Alice Test', text: 'Seed swap on Saturday' })
    expect(got.replies.map((r) => r.text)).toEqual(['I will bring beans'])
  })
  it('an at:// uri only', async () => {
    const m = mock('{}')
    expect(await fetchPostThread('https://bsky.app/x', m.f)).toBe('malformed')
    expect(m.calls).toHaveLength(0)
  })
})

describe('resolveHandle', () => {
  it('a handle becomes its did through the public AppView; a did stays', async () => {
    const m = mock(JSON.stringify({ did: 'did:plc:testalice234567' }))
    expect(await resolveHandle('alice.test.bsky.social', m.f)).toBe('did:plc:testalice234567')
    expect(m.calls[0].url).toBe('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=alice.test.bsky.social')
    expect(await resolveHandle('did:plc:testalice234567', m.f)).toBe('did:plc:testalice234567')
    expect(await resolveHandle('alice.test.bsky.social', mock(JSON.stringify({ did: 'nope' })).f)).toBe('malformed')
  })
})
