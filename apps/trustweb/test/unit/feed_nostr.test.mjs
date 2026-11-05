// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Feed over Nostr relays (NIP-29 groups): events, tags, post types, fan-out, relay setting. Fixed key, no network. */
import { addGroupPosts, buildJoin, buildLeave, buildPost, ensureNostrKey, groupTag, parseGroupPost, parseMembers, parseRelay, POST_TYPES } from '../../src/feed_nostr.ts'
import { finalizeEvent, hexToBytes } from '../../../demo/src/nostr_lib.ts'
import { groupPosts } from '../../src/feed_sources.ts'

const SK = '0000000000000000000000000000000000000000000000000000000000000001'
const NOW = 1_760_000_000_000
const tags = [{ id: 'climbers', colour: '#112233', label: 'Climbers' }]
const state = () => ({
  people: [], events: [{ id: 'e1', name: 'Hike', attended: true }], zoneTags: { friend: { ids: ['climbers'], stamp: 1 } },
  inventory: [], found: [], received: [], meetings: [], me: { id: 'me', displayName: 'Jakob' },
})

describe('post types and group tag', () => {
  it('has the four Hylo types', () => expect(POST_TYPES).toEqual(['discussion', 'request', 'offer', 'event']))
  it('makes a relay-safe group id', () => expect(groupTag('tag:climbers')).toBe('tag-climbers'))
})

describe('events', () => {
  it('a post is a signed kind 9 with the h tag and the type', () => {
    const ev = buildPost(SK, 'tag:climbers', 'Route open', 'offer', NOW)
    expect(ev.kind).toBe(9)
    expect(ev.created_at).toBe(Math.floor(NOW / 1000))
    expect(ev.tags).toContainEqual(['h', 'tag-climbers'])
    expect(ev.tags).toContainEqual(['type', 'offer'])
    expect(parseGroupPost(ev)).toMatchObject({ group: 'tag-climbers', type: 'offer', text: 'Route open', at: NOW - (NOW % 1000) })
  })
  it('join is 9021 and leave 9022, each with the h tag', () => {
    expect(buildJoin(SK, 'event:e1', NOW)).toMatchObject({ kind: 9021, tags: [['h', 'event-e1']] })
    expect(buildLeave(SK, 'event:e1', NOW)).toMatchObject({ kind: 9022, tags: [['h', 'event-e1']] })
  })
  it('a forged or untyped event is rejected / defaults to discussion', () => {
    const ev = buildPost(SK, 'tag:climbers', 'x', 'request', NOW)
    expect(parseGroupPost({ ...ev, content: 'tampered' })).toBeNull()
    expect(parseGroupPost({ ...ev, tags: [['h', 'g']] })).toBeNull()
    expect(parseGroupPost({ kind: 1, tags: [] })).toBeNull()
  })
  it('a validly signed post without a type reads as a discussion', () => {
    const ev = finalizeEvent({ kind: 9, created_at: 1, tags: [['h', 'g']], content: 'hi' }, hexToBytes(SK))
    expect(parseGroupPost(ev)).toMatchObject({ type: 'discussion', group: 'g' })
  })
  it('reads the member list of a 39002 event', () => {
    expect(parseMembers({ kind: 39002, tags: [['d', 'g'], ['p', 'aa'], ['p', 'bb', 'wss://r'], ['x', 'cc']] })).toEqual(['aa', 'bb'])
    expect(parseMembers({ kind: 1, tags: [['p', 'aa']] })).toEqual([])
  })
})

describe('relay setting', () => {
  it('accepts wss only (ws for local dev), normalised; rejects the rest', () => {
    expect(parseRelay('wss://relay.example.org/')).toBe('wss://relay.example.org')
    expect(parseRelay('ws://relay.example.org')).toBeNull()
    expect(parseRelay('ws://localhost:7777', true)).toBe('ws://localhost:7777')
    expect(parseRelay('https://x.org')).toBeNull()
    expect(parseRelay('')).toBeNull()
  })
})

describe('key', () => {
  it('is generated once and kept in the record', () => {
    const s = state()
    const a = ensureNostrKey(s)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(ensureNostrKey(s)).toBe(a)
    expect(s.nostrKey).toBe(a)
  })
})

describe('fan-out', () => {
  it('one post per group with the type, one event per group; local-only without a relay', () => {
    const s = state()
    const { posts, events } = addGroupPosts(s, ['tag:climbers', 'event:e1'], ' Need a rope ', 'request', NOW, tags, SK)
    expect(posts.map((p) => [p.group, p.type, p.text])).toEqual([['tag:climbers', 'request', 'Need a rope'], ['event:e1', 'request', 'Need a rope']])
    expect(events.map((e) => e.tags.find((t) => t[0] === 'h')[1])).toEqual(['tag-climbers', 'event-e1'])
    expect(s.groupPosts).toHaveLength(2)
    expect(s.groupPosts.every((p) => p.sent !== true)).toBe(true)
    expect(s.shares).toHaveLength(2)
  })
  it('skips groups the person is not in and empty text', () => {
    const s = state()
    expect(addGroupPosts(s, ['tag:nope'], 'x', 'offer', NOW, tags, SK).posts).toEqual([])
    expect(addGroupPosts(s, ['tag:climbers'], '  ', 'offer', NOW, tags, SK).posts).toEqual([])
  })
  it('feed posts carry the type chip and the unsent flag', () => {
    const s = state()
    addGroupPosts(s, ['tag:climbers'], 'Hi', 'event', NOW, tags, SK)
    expect(groupPosts(s, tags)[0]).toMatchObject({ type: 'event', unsent: true })
    s.groupPosts[0].sent = true
    expect(groupPosts(s, tags)[0].unsent).toBe(false)
  })
})
