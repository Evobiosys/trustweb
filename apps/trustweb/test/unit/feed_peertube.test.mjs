// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c feed-ext (κ): the public PeerTube reader. Recorded-shape fixtures (dummy channel), fetch injected: no network. */
import { readFileSync } from 'node:fs'
import { accountVideosUrl, fetchAccountVideos, fetchOembed, fetchVideo, oembedUrl, PEERTUBE_PAGE, videoUrl } from '../../src/feed_peertube.ts'

const fixture = (name) => readFileSync(new URL(`./fixtures/feed_ext/${name}`, import.meta.url), 'utf8')
const mock = (body, status = 200) => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return new Response(body, { status, headers: { 'Content-Type': 'application/json' } }) }
  return { f, calls }
}
const HOST = 'tube.test.example.org'

describe('urls', () => {
  it('account videos (newest first, a page), one video, oEmbed', () => {
    expect(accountVideosUrl(HOST, 'garden')).toBe(`https://${HOST}/api/v1/accounts/garden/videos?count=${PEERTUBE_PAGE}&start=0&sort=-publishedAt`)
    expect(accountVideosUrl(HOST, 'garden', 15)).toContain('&start=15&')
    expect(videoUrl(HOST, 'abcDEF123xyz')).toBe(`https://${HOST}/api/v1/videos/abcDEF123xyz`)
    expect(oembedUrl(HOST, `https://${HOST}/w/abcDEF123xyz`)).toBe(`https://${HOST}/services/oembed?format=json&url=https%3A%2F%2F${HOST}%2Fw%2FabcDEF123xyz`)
    expect(accountVideosUrl('localhost', 'garden')).toBeNull()
    expect(accountVideosUrl('127.0.0.1:9000', 'garden')).toBeNull()
    expect(accountVideosUrl('127.0.0.1:9000', 'garden', 0, true)).toBe(`http://127.0.0.1:9000/api/v1/accounts/garden/videos?count=${PEERTUBE_PAGE}&start=0&sort=-publishedAt`)
    expect(accountVideosUrl(HOST, '../admin')).toBeNull()
  })
})

describe('fetchAccountVideos', () => {
  it('public, safe-for-work videos as title + description + thumbnail + link; the next page when there is one', async () => {
    const m = mock(fixture('peertube_account_videos.json'))
    const got = await fetchAccountVideos(HOST, 'garden', m.f)
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(got.next).toBe(4)   // the next start: what came, not what was asked for
    expect(got.items.map((i) => i.id)).toEqual(['peertube:tube.test.example.org:0b2c1e30-1111-4222-8333-444455556666', 'peertube:tube.test.example.org:3b2c1e30-1111-4222-8333-444455556666'])
    expect(got.items[0]).toMatchObject({ who: 'Garden Collective', handle: '@garden@tube.test.example.org', video: true, url: 'https://tube.test.example.org/w/abcDEF123xyz', imageUrl: 'https://tube.test.example.org/lazy-static/thumbnails/0b2c.jpg', at: Date.parse('2026-11-10T12:00:00.000Z') })
    expect(got.items[0].text).toBe('Composting basics\nHow we compost **at home**.')
    expect(got.items[1]).toMatchObject({ url: 'https://tube.test.example.org/w/noUrl1234567' })
    expect(got.items[1].imageUrl).toBeUndefined()
  })
  it('the last page has no next', async () => {
    const got = await fetchAccountVideos(HOST, 'garden', mock(JSON.stringify({ total: 1, data: [] })).f)
    expect(got).toEqual({ items: [], total: 1 })
  })
  it('problems are reasons, a bad address asks nothing', async () => {
    expect(await fetchAccountVideos(HOST, 'garden', mock('', 429).f)).toBe('rate-limited')
    expect(await fetchAccountVideos(HOST, 'garden', mock('[]').f)).toBe('malformed')
    const m = mock('{}')
    expect(await fetchAccountVideos('localhost', 'garden', m.f)).toBe('malformed')
    expect(m.calls).toHaveLength(0)
  })
})

describe('fetchVideo and fetchOembed', () => {
  it('one video with its full description', async () => {
    const v = await fetchVideo(HOST, 'abcDEF123xyz', mock(fixture('peertube_video.json')).f)
    expect(v.text).toContain('The full description')
    expect(v).toMatchObject({ video: true, url: 'https://tube.test.example.org/w/abcDEF123xyz' })
  })
  it('oEmbed: title, author, thumbnail; the iframe html is never read', async () => {
    const o = await fetchOembed(HOST, `https://${HOST}/w/abcDEF123xyz`, mock(fixture('peertube_oembed.json')).f)
    expect(o).toEqual({ title: 'Composting basics', author: 'Garden Collective', thumbnailUrl: 'https://tube.test.example.org/lazy-static/previews/0b2c.jpg' })
    expect(JSON.stringify(o)).not.toContain('iframe')
  })
  it('a bad id or a foreign watch link asks nothing', async () => {
    const m = mock('{}')
    expect(await fetchVideo(HOST, '../x', m.f)).toBe('malformed')
    expect(await fetchOembed(HOST, 'https://other.example.org/w/abc', m.f)).toBe('malformed')
    expect(m.calls).toHaveLength(0)
  })
})
