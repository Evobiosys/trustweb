/**
 * The Feed (wave 1733 round B, items 1 and 2): posts only from what the phone
 * holds (answers, meetings sent to you, shared notes, what you share), demo
 * content marked, newest first; building it sends NOTHING (no fetch, no
 * socket); Mastodon/Pixelfed read as services: addresses, plain text from
 * remote HTML, the public API with its failures, pictures only when switched
 * on, and the share links by post type.
 */
import { buildFeed, PostKind } from '../../src/feed.ts'
import { FetchProblem, handleText, htmlToText, instanceBase, lookupAccount, parseHandle, parseInstance, profileUrl, publicStatuses, remotePosts, shareOrder, ShareTarget, shareUrlFor } from '../../src/fediverse.ts'
import { Audience, feedOn, LineStatus, Ring } from '../../src/model.ts'

const NOW = 1_760_000_000_000
const state = () => ({
  v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false,
  people: [
    { id: 'anna', name: 'Anna', context: '', ring: Ring.Close, metAt: NOW, lines: [
      { id: 'n1', text: 'Has a ladder', tag: 'offer', audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: NOW - 5000, checkedAt: NOW, source: { kind: 'shared-by-person', fromName: 'Anna' } },
      { id: 'n2', text: 'My own note', tag: 'note', audience: Audience.Friends, status: LineStatus.Current, notedAt: NOW - 4000, checkedAt: NOW, source: { kind: 'typed' } },
    ] },
    { id: 'maya', name: 'Maya', context: '', ring: Ring.Friend, metAt: NOW, lines: [] },
  ],
  inventory: [
    { id: 'i1', text: 'Cargo bike', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW - 1000, source: { kind: 'typed' }, imageId: 'img-1' },
    { id: 'i2', text: 'Only mine', audience: Audience.OnlyMe, included: true, createdAt: NOW - 900 },
    { id: 'i3', text: 'Paused', audience: Audience.Friends, included: false, createdAt: NOW - 800 },
    { id: 'demo-i', text: 'Dummy thing', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW - 700, source: { kind: 'demo' } },
  ],
  demo: { people: ['maya'], inventory: ['demo-i'] },
  found: [{ id: 'f1', at: NOW - 3000, text: 'ladder?', shared: [{ from: 'Maya', items: [{ text: 'Maya has a ladder', context: 'What I have', when: 'early October' }] }] }],
  received: [
    { id: 'r1', at: NOW - 2000, fromName: 'Anna', fromPeerId: 'p', link: 'x', title: 'Meeting with Anna', keptAs: 'mk' },
    { id: 'r2', at: NOW - 100, fromName: 'Lea', fromPeerId: 'q', link: 'y', title: 'Meeting with Lea' },
  ],
  meetings: [
    { id: 'mk', about: 'Anna', kind: 'who', personId: 'anna', where: 'Hub', startedAt: NOW - 9000, endedAt: 0, durationMs: 0, meeting: true, lines: [], transcript: [], fromName: 'Anna' },
    { id: 'mc', about: 'Ben', kind: 'who', where: 'Café', startedAt: NOW - 8000, endedAt: 0, durationMs: 0, meeting: true, lines: [], transcript: [], fromName: 'Ben' },
    { id: 'own', about: 'Mine', kind: 'what', where: '', startedAt: NOW - 50, endedAt: 0, durationMs: 0, meeting: false, lines: [], transcript: [] },
  ],
})

describe('the Feed', () => {
  it('shows what the phone holds, newest first, each with who, when, what, provenance and where it opens', () => {
    const posts = buildFeed(state())
    expect(posts.map((p) => [p.kind, p.who, p.text])).toEqual([
      [PostKind.Meeting, 'Lea', 'Meeting with Lea'],
      [PostKind.Mine, null, 'Dummy thing'],
      [PostKind.Mine, null, 'Cargo bike'],
      [PostKind.Meeting, 'Anna', 'Meeting with Anna'],
      [PostKind.Answer, 'Maya', 'Maya has a ladder'],
      [PostKind.Note, 'Anna', 'Has a ladder'],
      [PostKind.Meeting, 'Ben', 'Ben'],
    ])
    const by = (t) => posts.find((p) => p.text === t)
    expect(by('Meeting with Anna').open).toEqual({ kind: 'meeting', meetingId: 'mk' })
    expect(by('Meeting with Lea').open).toEqual({ kind: 'share', receivedId: 'r2' })
    expect(by('Cargo bike')).toMatchObject({ open: { kind: 'item', itemId: 'i1' }, imageId: 'img-1', provenance: 'typed', dummy: false })
    expect(by('Maya has a ladder')).toMatchObject({ dummy: true, context: 'ladder?', provenance: 'shared-by-person', open: { kind: 'person', personId: 'maya' } })
    expect(by('Dummy thing').dummy).toBe(true)
    expect(posts.some((p) => ['Only mine', 'Paused', 'My own note', 'Mine'].includes(p.text))).toBe(false)
  })
  it('building it sends nothing: no fetch, no socket, no beacon', () => {
    const calls = []
    const saved = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, sendBeacon: globalThis.navigator?.sendBeacon }
    globalThis.fetch = (...a) => { calls.push(['fetch', a]); return Promise.reject(new Error('no')) }
    globalThis.WebSocket = function () { calls.push(['ws']) }
    try {
      buildFeed(state())
      buildFeed({ ...state(), found: 'odd', received: null, meetings: [null] })
    } finally {
      globalThis.fetch = saved.fetch
      globalThis.WebSocket = saved.WebSocket
    }
    expect(calls).toEqual([])
  })
  it('an empty phone has an empty Feed; the Feed is on unless switched off', () => {
    expect(buildFeed({ ...state(), people: [], inventory: [], found: [], received: [], meetings: [] })).toEqual([])
    expect(feedOn({})).toBe(true)
    expect(feedOn({ feed: { on: false } })).toBe(false)
  })
})

describe('Mastodon and Pixelfed as services', () => {
  it('reads addresses and profile links; refuses anything else; local test instances only when allowed', () => {
    expect(parseHandle('@anna@mastodon.social')).toEqual({ user: 'anna', host: 'mastodon.social' })
    expect(parseHandle('https://pixelfed.social/@anna')).toEqual({ user: 'anna', host: 'pixelfed.social' })
    expect(parseHandle('anna')).toBe(null)
    expect(parseHandle('anna@local')).toBe(null)
    expect(parseHandle('a b@x.org')).toBe(null)
    expect(parseHandle('anna@127.0.0.1:5290')).toBe(null)
    expect(parseHandle('anna@127.0.0.1:5290', true)).toEqual({ user: 'anna', host: '127.0.0.1:5290' })
    expect(handleText({ user: 'anna', host: 'x.org' })).toBe('anna@x.org')
    expect(instanceBase('127.0.0.1:5290')).toBe('http://127.0.0.1:5290')
    expect(profileUrl({ user: 'anna', host: 'x.org' })).toBe('https://x.org/@anna')
  })
  it('remote HTML becomes plain text; markup never survives', () => {
    expect(htmlToText('<p>Hello <b>world</b> &amp; you</p><p>Second<br>line</p>')).toBe('Hello world & you\n\nSecond\nline')
    expect(htmlToText('<img src=x onerror=alert(1)><script>alert(2)</script>ok')).toBe('ok')
  })
  it('the public API: lookup then statuses; down, CORS refused, rate limit, unknown, malformed', async () => {
    const h = { user: 'anna', host: 'x.org' }
    const ok = (body, status = 200) => async () => new Response(JSON.stringify(body), { status })
    expect(await lookupAccount(h, ok({ id: '1091' }))).toBe('1091')
    expect(await lookupAccount(h, async () => { throw new TypeError('Failed to fetch') })).toBe(FetchProblem.Unreachable)
    expect(await lookupAccount(h, ok({}, 429))).toBe(FetchProblem.RateLimited)
    expect(await lookupAccount(h, ok({}, 404))).toBe(FetchProblem.NotFound)
    expect(await lookupAccount(h, ok({ id: '<script>' }))).toBe(FetchProblem.Malformed)
    expect(await lookupAccount(h, async () => new Response('not json', { status: 200 }))).toBe(FetchProblem.Malformed)
    const statuses = await publicStatuses(h, '1091', ok([
      { id: 's1', created_at: '2026-10-06T10:00:00Z', content: '<p>Public <a href="x">post</a></p>', url: 'https://x.org/@anna/s1', visibility: 'public', media_attachments: [{ type: 'image', preview_url: 'https://x.org/p.jpg', description: 'a bike' }] },
      { id: 's2', created_at: '2026-10-06T09:00:00Z', content: '<p>private</p>', visibility: 'private' },
      { id: 's3', created_at: 'bad', content: 'x' },
      { id: 's4', created_at: '2026-10-06T08:00:00Z', content: '<p>javascript</p>', url: 'javascript:alert(1)', media_attachments: [{ type: 'image', url: 'javascript:alert(1)' }] },
    ]))
    expect(statuses.map((s) => [s.id, s.text, s.imageUrl ?? null, s.url])).toEqual([
      ['s1', 'Public post', 'https://x.org/p.jpg', 'https://x.org/@anna/s1'],
      ['s4', 'javascript', null, 'https://x.org/'],
    ])
    expect(await publicStatuses(h, '1', ok({ not: 'a list' }))).toBe(FetchProblem.Malformed)
  })
  it('remote posts carry pictures only when pictures are switched on, and open the post on its instance', () => {
    const p = { id: 'anna', name: 'Anna' }
    const link = { handle: 'anna@x.org', show: true, reach: 'api' }
    const st = [{ id: 's1', at: 5, text: 'Hi', url: 'https://x.org/@anna/s1', imageUrl: 'https://x.org/p.jpg' }]
    expect(remotePosts(p, link, st, false)[0].imageUrl).toBe(undefined)
    expect(remotePosts(p, link, st, true)[0]).toMatchObject({ kind: 'remote', who: 'Anna', imageUrl: 'https://x.org/p.jpg', open: { kind: 'url', url: 'https://x.org/@anna/s1' } })
  })
  it('share out: a picture to Pixelfed first, text to Mastodon first; Mastodon prefills, Pixelfed opens compose', () => {
    expect(shareOrder(true)).toEqual([ShareTarget.Pixelfed, ShareTarget.Mastodon])
    expect(shareOrder(false)).toEqual([ShareTarget.Mastodon, ShareTarget.Pixelfed])
    expect(shareUrlFor(ShareTarget.Mastodon, 'mastodon.social', 'a & b')).toBe('https://mastodon.social/share?text=a%20%26%20b')
    expect(shareUrlFor(ShareTarget.Pixelfed, 'pixelfed.social', 'x')).toBe('https://pixelfed.social/i/compose')
    expect(parseInstance('https://Mastodon.Social/about')).toBe('mastodon.social')
    expect(parseInstance('not an instance')).toBe(null)
  })
})
