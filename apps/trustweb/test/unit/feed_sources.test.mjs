// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Feed sources (wave 31): groups the user is in, group posts, follow URLs, RSS/JSON parsing, ask cards, filter chips. */
import { askPosts, buildFeed, filterFeed, FeedSource, PostKind, sourceOf } from '../../src/feed.ts'
import { addGroupPost, followUrl, groupPosts, groupsOf, parseFeedText, parseFollow, sourceCounts } from '../../src/feed_sources.ts'

const NOW = 1_760_000_000_000
const tags = [{ id: 'climbers', colour: '#112233', label: 'Climbers' }, { id: 'other', colour: '#445566' }]
const base = () => ({
  people: [{ id: 'a', name: 'Anna', lines: [], fields: { climbers: 'true' }, events: ['e1'] }, { id: 'b', name: 'Ben', lines: [], fields: {} }],
  events: [{ id: 'e1', name: 'Hike', attended: true }, { id: 'e2', name: 'Skipped', attended: false }],
  zoneTags: { friend: { ids: ['climbers'], stamp: 1 } },
  inventory: [], found: [], received: [], meetings: [], me: { id: 'me', displayName: 'Jakob' },
})

describe('groups', () => {
  it('lists only groups the user is in: zone tags and attended events', () => {
    expect(groupsOf(base(), tags).map((g) => [g.id, g.name])).toEqual([['tag:climbers', 'Climbers'], ['event:e1', 'Hike']])
  })
  it('a post is a record line and a share line to the group only', () => {
    const s = base()
    const p = addGroupPost(s, 'tag:climbers', ' Route open ', NOW, tags)
    expect(p).toMatchObject({ kind: 'post', group: 'tag:climbers', text: 'Route open', by: 'Jakob', at: NOW })
    expect(s.groupPosts).toHaveLength(1)
    expect(s.shares[0].scope).toEqual({ zone: 'self', include: ['tag:climbers'], exclude: [] })
  })
  it('refuses a group the user is not in, and empty text', () => {
    const s = base()
    expect(addGroupPost(s, 'tag:other', 'x', NOW, tags)).toBeNull()
    expect(addGroupPost(s, 'tag:climbers', '  ', NOW, tags)).toBeNull()
    expect(s.groupPosts).toBeUndefined()
  })
  it('shows posts of groups the user is in only', () => {
    const s = base()
    s.groupPosts = [{ id: 'p1', kind: 'post', group: 'tag:climbers', text: 'hi', by: 'Jakob', at: NOW }, { id: 'p2', kind: 'post', group: 'tag:gone', text: 'no', by: 'X', at: NOW }]
    expect(groupPosts(s, tags).map((p) => [p.id, p.kind, p.group])).toEqual([['group:p1', PostKind.Group, 'tag:climbers']])
  })
})

describe('follows and parsing', () => {
  it('maps an account and a hashtag to their public RSS', () => {
    expect(followUrl(parseFollow('@anna@mastodon.social'))).toBe('https://mastodon.social/@anna.rss')
    expect(followUrl(parseFollow('#climbing@mastodon.social'))).toBe('https://mastodon.social/tags/climbing.rss')
    expect(parseFollow('nonsense')).toBeNull()
    expect(parseFollow('@a@localhost')).toBeNull()
  })
  it('reads RSS as plain text', () => {
    const xml = '<rss><channel><item><guid>g1</guid><link>https://m.social/@a/1</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;</description></item></channel></rss>'
    const r = parseFeedText(xml)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'g1', url: 'https://m.social/@a/1', text: 'Hello world' })
    expect(r[0].at).toBe(Date.parse('2026-11-03T10:00:00Z'))
  })
  it('reads JSON Feed and drops unsafe links', () => {
    const j = JSON.stringify({ items: [{ id: '1', url: 'https://n.example/1', title: 'T', content_text: 'Body', date_published: '2026-11-01T00:00:00Z' }, { id: '2', url: 'javascript:alert(1)', title: 'Bad' }] })
    const r = parseFeedText(j)
    expect(r.map((x) => x.id)).toEqual(['1', '2'])
    expect(r[0].text).toBe('T\nBody')
    expect(r[1].url).toBeUndefined()
  })
  it('garbage gives nothing', () => { expect(parseFeedText('<html>nope')).toEqual([]) ; expect(parseFeedText('{bad')).toEqual([]) })
})

describe('ask cards and filters', () => {
  it('asks addressed to me become cards', () => {
    const s = base()
    s.heldAsks = [{ qid: 'q1', peerId: 'p', text: 'Ladder?', fromName: 'Ben', receivedAt: NOW }]
    s.unmatchedAsks = [{ id: 'q2', at: NOW - 1, peerId: 'p', from: 'Ben', text: 'Tent?', reason: 'nothing' }]
    const a = askPosts(s)
    expect(a.map((p) => [p.id, p.kind, p.who])).toEqual([['ask:q1', PostKind.Ask, 'Ben'], ['ask:q2', PostKind.Ask, 'Ben']])
  })
  it('hides unmatched cards when the setting says no', () => {
    const s = base()
    s.showUnmatchedAsks = false
    s.unmatchedAsks = [{ id: 'q2', at: NOW, peerId: 'p', from: 'Ben', text: 'Tent?', reason: 'nothing' }]
    expect(askPosts(s)).toEqual([])
  })
  it('filters by source and by group', () => {
    const s = base()
    s.groupPosts = [{ id: 'p1', kind: 'post', group: 'tag:climbers', text: 'hi', by: 'Jakob', at: NOW }, { id: 'p3', kind: 'post', group: 'event:e1', text: 'hike', by: 'Jakob', at: NOW - 5 }]
    s.inventory = [{ id: 'i1', text: 'Bike', audience: 'friends', included: true, createdAt: 1 }]
    const all = buildFeed(s, groupPosts(s, tags))
    expect(all.map((p) => sourceOf(p))).toEqual([FeedSource.Group, FeedSource.Group, FeedSource.Web])
    expect(filterFeed(all, { source: FeedSource.Group }).length).toBe(2)
    expect(filterFeed(all, { source: FeedSource.Group, group: 'event:e1' }).map((p) => p.id)).toEqual(['group:p3'])
    expect(filterFeed(all, {}).length).toBe(3)
    expect(sourceCounts(all)).toEqual({ web: 1, group: 2, fediverse: 0, news: 0, ask: 0 })
  })
})
