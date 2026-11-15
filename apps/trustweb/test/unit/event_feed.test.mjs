// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-feed: the Mastodon-style Feed (own posts, reply, star), the per-event tag filter, Timeline apart from Feed, the bar order. */
import { eventTagLabel, eventTagSlug } from '../../src/events.ts'
import { buildFeed, filterFeed, isTimelinePost, PostKind, socialPosts } from '../../src/feed.ts'
import { addSocialPost, editSocialPost, eventFeedOn, feedList, tagOfEvent, toggleStar } from '../../src/feed_social.ts'
import { groupPosts } from '../../src/feed_sources.ts'

const NOW = 1_760_000_000_000
const base = () => ({
  people: [], inventory: [], found: [], received: [], meetings: [], me: { id: 'me', displayName: 'Jakob' },
  events: [{ id: 'e1', name: 'Winter IYG!', attended: true, offers: { feed: true } }, { id: 'e2', name: 'Quiet', attended: true }],
})

describe('event tag', () => {
  it('code form event_<slug>, app form #event:<name>', () => {
    expect(eventTagSlug('Winter IYG!')).toBe('event_Winter_IYG')
    expect(eventTagSlug('  Fête  du  Nord ')).toBe('event_Fête_du_Nord')
    expect(eventTagLabel('Winter IYG')).toBe('#event:Winter IYG')
    expect(tagOfEvent({ name: 'Fête  du Nord!' })).toBe(eventTagSlug('Fête  du Nord!'))   // feed_social's plain-node copy agrees with event_tag.ts
  })
})

describe('own posts', () => {
  it('addSocialPost trims, refuses empty text, keeps the post on this phone', () => {
    const s = base()
    expect(addSocialPost(s, '   ', NOW)).toBeNull()
    expect(s.feedPosts).toBeUndefined()
    expect(addSocialPost(s, ' Hello ', NOW)).toMatchObject({ text: 'Hello', at: NOW, by: 'Jakob' })
    expect(s.feedPosts).toHaveLength(1)
  })
  it('an event post carries the event tag; an unknown event is refused', () => {
    const s = base()
    expect(addSocialPost(s, 'Arrived', NOW, { eventId: 'e1' })).toMatchObject({ tag: 'event_Winter_IYG', eventId: 'e1' })
    expect(addSocialPost(s, 'x', NOW, { eventId: 'nope' })).toBeNull()
    expect(s.feedPosts).toHaveLength(1)
  })
  it('a reply keeps the id and a short snapshot of the post it answers (any Feed post), shown as its context line', () => {
    const s = base()
    const r = addSocialPost(s, 'I do', NOW + 5, { replyTo: 'group:g9', replyText: 'Who brings tea?' })
    expect(r).toMatchObject({ replyTo: 'group:g9', replyText: 'Who brings tea?' })
    expect(socialPosts(s).find((p) => p.id === `social:${r.id}`)).toMatchObject({ kind: PostKind.Social, who: null, context: 'Who brings tea?' })
    expect(addSocialPost(s, 'x', NOW, { replyTo: 'g', replyText: 'y'.repeat(300) }).replyText).toHaveLength(120)
  })
  it('editSocialPost changes the text of my own post only, never to empty', () => {
    const s = base()
    const a = addSocialPost(s, 'typo', NOW)
    expect(editSocialPost(s, a.id, ' fixed ')).toBe(true)
    expect(s.feedPosts[0]).toMatchObject({ text: 'fixed', at: NOW })
    expect(editSocialPost(s, a.id, '  ')).toBe(false)
    expect(editSocialPost(s, 'ghost', 'x')).toBe(false)
    expect(s.feedPosts[0].text).toBe('fixed')
  })
  it('a star toggles on and off and survives in the record', () => {
    const s = base()
    const a = addSocialPost(s, 'hi', NOW)
    expect(toggleStar(s, `social:${a.id}`)).toBe(true)
    expect(s.feedStars).toEqual([`social:${a.id}`])
    expect(toggleStar(s, `social:${a.id}`)).toBe(false)
    expect(s.feedStars).toEqual([])
  })
})

describe('feed and timeline apart', () => {
  it('social and group posts are Feed; answers, meetings, notes, mine and asks are Timeline', () => {
    const s = base()
    s.groupPosts = [{ id: 'g1', kind: 'post', group: 'event:e1', text: 'from group', by: 'Ben', at: NOW }]
    addSocialPost(s, 'mine', NOW + 1)
    s.inventory = [{ id: 'i1', text: 'A ladder', included: true, audience: 'trusted', createdAt: NOW }]
    const all = buildFeed(s, groupPosts(s, []))
    expect(all.filter(isTimelinePost).map((p) => p.kind)).toEqual([PostKind.Mine])
    expect(all.filter((p) => !isTimelinePost(p)).map((p) => p.kind).sort()).toEqual([PostKind.Group, PostKind.Social])
  })
  it('newest first', () => {
    const s = base()
    addSocialPost(s, 'old', NOW)
    addSocialPost(s, 'new', NOW + 10)
    expect(buildFeed(s).map((p) => p.text)).toEqual(['new', 'old'])
  })
})

describe('per-event feed', () => {
  it('reads offers.feed defensively: absent, malformed or off = off', () => {
    expect(eventFeedOn({ offers: { feed: true } })).toBe(true)
    for (const ev of [{}, { offers: null }, { offers: { feed: 'yes' } }, { offers: {} }, { offers: { feed: false } }]) expect(eventFeedOn(ev)).toBe(false)
  })
  it('filterFeed by tag keeps social posts and the event group posts of that event only', () => {
    const s = base()
    s.groupPosts = [{ id: 'g1', kind: 'post', group: 'event:e1', text: 'g e1', by: 'Ben', at: NOW }, { id: 'g2', kind: 'post', group: 'event:e2', text: 'g e2', by: 'Ben', at: NOW }]
    addSocialPost(s, 'tagged', NOW + 1, { eventId: 'e1' })
    addSocialPost(s, 'untagged', NOW + 2)
    const posts = buildFeed(s, groupPosts(s, []))
    expect(filterFeed(posts, { tag: 'event_Winter_IYG' }).map((p) => p.text).sort()).toEqual(['g e1', 'tagged'])
  })
})

describe('feedList (MCP)', () => {
  it('lists social and group posts newest first, optionally of one event, limited', () => {
    const s = base()
    s.groupPosts = [{ id: 'g1', kind: 'post', group: 'event:e1', text: 'g e1', by: 'Ben', at: NOW }]
    addSocialPost(s, 'a', NOW + 1, { eventId: 'e1' })
    addSocialPost(s, 'b', NOW + 2)
    expect(feedList(s, {}).map((p) => p.text)).toEqual(['b', 'a', 'g e1'])
    expect(feedList(s, { eventId: 'e1' }).map((p) => p.text)).toEqual(['a', 'g e1'])
    expect(feedList(s, { limit: 1 })).toHaveLength(1)
    expect(() => feedList(s, { eventId: 'nope' })).toThrow(/no event/)
  })
})
