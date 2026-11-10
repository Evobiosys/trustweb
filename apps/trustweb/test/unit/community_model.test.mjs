// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 community-mighty: the pure view models of the Community view (src/ext/community-mighty/community_model.ts). */
import {
  NAV, parseCommunity, navItems, buildPosts, buildSpaces, joinSpace, leaveSpace, buildMembers, buildEvents,
  addResource, resolveView, forkView, addToView, hideInView, moveInView, docsEmbedUrl, telegramUrl, communityTagOf,
} from '../../src/ext/community-mighty/community_model.ts'
import { mergeCommunity } from '../../src/ext/community-mighty/community_data.ts'
import { mergeExtData, EXT_DATA_MERGERS } from '../../src/ext/ext_data.ts'

const TAGS = [
  { id: 'iyg', colour: '#1565c0', label: 'IYG', community: true },
  { id: 'garden', colour: '#2e7d32', label: 'Garden', community: true },
  { id: 'work', colour: '#c2185b', label: 'Work' },
]
const person = (id, name, ring, fields = {}) => ({ id, name, context: '', ring, lines: [], fields })
const base = () => ({
  me: { id: 'me', displayName: 'Ana' },
  people: [
    person('p1', 'Ben', 'close', { iyg: 'true' }),
    person('p2', 'Cleo', 'friend', { iyg: 'true', garden: 'true' }),
    person('p3', 'Dan', 'acquaintance', {}),
    { ...person('p4', 'Eve', 'closest', { iyg: 'true' }), deleted_at: '2026-11-01' },
    { ...person('p5', 'Finn', 'friend', { iyg: 'true' }), blocked: 5 },
  ],
  peers: [], inventory: [], log: [], notificationsOn: false,
})

describe('community settings', () => {
  it('parses junk to an empty object and keeps only valid fields', () => {
    expect(parseCommunity(undefined)).toEqual({})
    expect(parseCommunity('x')).toEqual({})
    const d = parseCommunity({ tag: 'iyg', navOff: ['chat', 'nope'], docsConsent: true, telegramUrl: 'https://t.me/x', resources: [{ id: 'r1', title: 'A', url: 'https://a.org', by: 'Ana', at: 1 }, { id: 2 }, { id: 'r3', title: 'x', url: 'javascript:alert(1)', by: 'Ana', at: 1 }] })
    expect(d.tag).toBe('iyg')
    expect(d.navOff).toEqual(['chat'])
    expect(d).not.toHaveProperty('docsConsent')
    expect(d.telegramUrl).toBe('https://t.me/x')
    expect(d.resources).toHaveLength(1)
  })

  it('nav lists the six items in order, minus the ones switched off', () => {
    expect(NAV).toEqual(['home', 'spaces', 'events', 'members', 'docs', 'chat'])
    expect(navItems({})).toEqual(NAV)
    expect(navItems({ navOff: ['events', 'chat'] })).toEqual(['home', 'spaces', 'members', 'docs'])
  })

  it('the community tag: own choice first, else the rings community tag, else the first community tag', () => {
    expect(communityTagOf({ tag: 'garden' }, { uiRings: { community: 'iyg' } }, TAGS)).toBe('garden')
    expect(communityTagOf({}, { uiRings: { community: 'iyg' } }, TAGS)).toBe('iyg')
    expect(communityTagOf({}, {}, TAGS)).toBe('iyg')
    expect(communityTagOf({}, {}, [])).toBeNull()
    expect(communityTagOf({ tag: 'gone' }, {}, TAGS)).toBe('iyg')
  })
})

describe('posts', () => {
  it('merges group posts, shared notes and co-notes, newest first, with the space name', () => {
    const s = base()
    s.zoneTags = { self: { ids: ['iyg'], stamp: 1 } }
    s.groupPosts = [{ id: 'g1', kind: 'post', group: 'tag:iyg', text: 'Hello circle', by: 'Ben', at: 300 }]
    s.people[0].lines = [{ id: 'l1', text: 'Ben likes bikes', status: 'current', notedAt: 200, source: { kind: 'shared-by-person', fromName: 'Ben' } }]
    s.coNotes = [{ id: 'c1', title: 'Garden plan', mode: 'outline', blocks: [{ id: 'b', text: 'x' }], people: [{ did: 'd', name: 'Ana' }, { did: 'e', name: 'Cleo' }], clock: 1, seen: { d: 100, e: 250 } }]
    const posts = buildPosts(s, TAGS)
    expect(posts.map((p) => p.id)).toEqual(['group:g1', 'co:c1', 'note:p1:l1'])
    expect(posts[0]).toMatchObject({ who: 'Ben', space: 'IYG', text: 'Hello circle' })
    expect(posts[1]).toMatchObject({ text: 'Garden plan', at: 250, who: 'Ana, Cleo' })
    expect(posts[2]).toMatchObject({ personId: 'p1' })
  })

  it('a space filter keeps only that space', () => {
    const s = base()
    s.zoneTags = { self: { ids: ['iyg', 'garden'], stamp: 1 } }
    s.groupPosts = [
      { id: 'g1', kind: 'post', group: 'tag:iyg', text: 'a', by: 'Ana', at: 1 },
      { id: 'g2', kind: 'post', group: 'tag:garden', text: 'b', by: 'Ana', at: 2 },
    ]
    expect(buildPosts(s, TAGS, 'garden').map((p) => p.id)).toEqual(['group:g2'])
    expect(buildPosts(s, TAGS)[0].who).toBeNull()
  })
})

describe('spaces', () => {
  it('community tags as spaces with colour, live member count and joined state', () => {
    const s = base()
    s.zoneTags = { self: { ids: ['garden'], stamp: 1 } }
    const sp = buildSpaces(s, TAGS)
    expect(sp.map((x) => x.id)).toEqual(['iyg', 'garden'])
    expect(sp[0]).toMatchObject({ name: 'IYG', colour: '#1565c0', members: 2, joined: false })
    expect(sp[1]).toMatchObject({ members: 1, joined: true })
  })

  it('join puts the tag on my own zone (a group I am in), leave takes it off', () => {
    const s = base()
    joinSpace(s, TAGS, 'iyg', 5)
    expect(s.zoneTags.self.ids).toEqual(['iyg'])
    expect(buildSpaces(s, TAGS)[0].joined).toBe(true)
    joinSpace(s, TAGS, 'iyg', 6)
    expect(s.zoneTags.self.ids).toEqual(['iyg'])
    leaveSpace(s, 'iyg', 7)
    expect(s.zoneTags.self.ids).toEqual([])
    expect(() => joinSpace(s, TAGS, 'unknown', 8)).not.toThrow()
    expect(s.zoneTags.self.ids).toEqual([])
  })

  it('join goes by tag id, even when another tag is labelled like it', () => {
    const tags = [{ id: 'a', colour: '#111111', label: 'b', community: true }, { id: 'b', colour: '#222222', label: 'B2', community: true }]
    const s = base()
    joinSpace(s, tags, 'b', 1)
    expect(s.zoneTags.self.ids).toEqual(['b'])
  })

  it('a tag kept on a ring zone counts as joined, but only my own join can be left', () => {
    const s = base()
    s.zoneTags = { friend: { ids: ['iyg'], stamp: 1 } }
    expect(buildSpaces(s, TAGS)[0]).toMatchObject({ joined: true, leavable: false })
    joinSpace(s, TAGS, 'iyg', 2)
    expect(buildSpaces(s, TAGS)[0]).toMatchObject({ joined: true, leavable: true })
  })
})

describe('members', () => {
  it('people carrying the tag, closest ring first then name; deleted and blocked left out', () => {
    const m = buildMembers(base().people, 'iyg')
    expect(m.map((x) => x.id)).toEqual(['p1', 'p2'])
    expect(m[0]).toMatchObject({ name: 'Ben', ring: 'close', initial: 'B' })
    expect(buildMembers(base().people, null)).toEqual([])
  })
})

describe('events', () => {
  it('upcoming soonest first, then past newest first, with a date block', () => {
    const now = Date.parse('2026-11-10T08:00:00Z')
    const ev = (id, from, attended = false) => ({ id, name: id, from, where: 'Wien', createdAt: 0, attended, hosts: ['Ben'] })
    const cards = buildEvents([ev('old', '2026-10-01'), ev('soon', '2026-11-12', true), ev('later', '2026-12-24'), ev('older', '2026-09-01')], now)
    expect(cards.map((c) => c.id)).toEqual(['soon', 'later', 'old', 'older'])
    expect(cards[0]).toMatchObject({ day: '12', month: 'Nov', going: true, past: false, where: 'Wien', host: 'Ben' })
    expect(cards[2].past).toBe(true)
    expect(buildEvents(undefined, now)).toEqual([])
  })
})

describe('resource views', () => {
  const res = (id, by) => ({ id, title: id.toUpperCase(), url: `https://x.org/${id}`, by, at: 1 })
  const resources = [res('a', 'Ana'), res('b', 'Ben'), res('c', 'Cleo'), res('d', 'Ben')]

  it('my order first; hidden ones listed last as hidden; the rest at the bottom as new (greyed, with add)', () => {
    const rows = resolveView(resources, { owner: 'Ana', order: ['c', 'a', 'gone'], hidden: ['d'] })
    expect(rows.map((r) => [r.item.id, r.state])).toEqual([['c', 'shown'], ['a', 'shown'], ['b', 'new'], ['d', 'hidden']])
  })

  it('no view yet: everything is new', () => {
    expect(resolveView(resources, undefined).every((r) => r.state === 'new')).toBe(true)
  })

  it('fork copies another member\'s order and hiding as my own view, without touching theirs', () => {
    const theirs = { owner: 'Ben', order: ['b', 'd'], hidden: ['a'] }
    const mine = forkView(theirs, 'Ana')
    expect(mine).toEqual({ owner: 'Ana', order: ['b', 'd'], hidden: ['a'], from: 'Ben' })
    mine.order.push('c')
    expect(theirs.order).toEqual(['b', 'd'])
  })

  it('add puts an item at the end of my order and unhides it; hide takes it out of the order; move swaps neighbours', () => {
    let v = { owner: 'Ana', order: ['a'], hidden: ['b'] }
    v = addToView(v, 'b')
    expect(v).toMatchObject({ order: ['a', 'b'], hidden: [] })
    v = addToView(v, 'b')
    expect(v.order).toEqual(['a', 'b'])
    v = moveInView(v, 'b', -1)
    expect(v.order).toEqual(['b', 'a'])
    v = moveInView(v, 'b', -1)
    expect(v.order).toEqual(['b', 'a'])
    v = hideInView(v, 'a')
    expect(v).toMatchObject({ order: ['b'], hidden: ['a'] })
  })

  it('adding a resource puts it into the shared list and at the end of my view; bad links are refused', () => {
    const d = {}
    expect(addResource(d, { title: 'Guide', url: 'https://docs.example.org/g' }, 'Ana', 9)).toBe(true)
    expect(d.resources[0]).toMatchObject({ title: 'Guide', by: 'Ana', at: 9 })
    expect(d.mine.order).toEqual([d.resources[0].id])
    expect(addResource(d, { title: 'x', url: 'javascript:alert(1)' }, 'Ana', 10)).toBe(false)
    expect(addResource(d, { title: '', url: 'https://a.org' }, 'Ana', 10)).toBe(true)
    expect(d.resources[1].title).toBe('a.org')
  })
})

describe('device sync merge', () => {
  const r = (id) => ({ id, title: id, url: `https://x.org/${id}`, by: 'Ana', at: 1 })
  it('resources join by id; my order keeps mine first then theirs; hiding wins; other members\' views by owner', () => {
    const mine = { tag: 'iyg', resources: [r('a'), r('b')], mine: { owner: 'Ana', order: ['b', 'a'], hidden: [] }, views: [{ owner: 'Ben', order: ['a'], hidden: [] }] }
    const theirs = { tag: 'garden', resources: [r('a'), r('c')], mine: { owner: 'Ana', order: ['c'], hidden: ['b'] }, views: [{ owner: 'Ben', order: ['c', 'a'], hidden: [] }, { owner: 'Cleo', order: [], hidden: [] }] }
    const m = mergeCommunity(mine, theirs)
    expect(m.resources.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(m.mine).toEqual({ owner: 'Ana', order: ['a', 'c'], hidden: ['b'] })
    expect(m.views.map((v) => [v.owner, v.order.join()])).toEqual([['Ben', 'c,a'], ['Cleo', '']])
    expect(m.tag).toBe('garden')
  })

  it('extData merges per module: a registered rule where both sides hold the module, else whichever side has it', () => {
    EXT_DATA_MERGERS.set('t-mod', (a, b) => ({ n: a.n + b.n }))
    expect(mergeExtData({ 't-mod': { n: 1 }, x: 1 }, { 't-mod': { n: 2 }, y: 2 })).toEqual({ 't-mod': { n: 3 }, x: 1, y: 2 })
    expect(mergeExtData(undefined, { y: 2 })).toEqual({ y: 2 })
    expect(mergeExtData({ z: 1 }, { z: 2 })).toEqual({ z: 2 })
    expect(mergeExtData({ a: 1 }, 'junk')).toEqual({ a: 1 })
    EXT_DATA_MERGERS.delete('t-mod')
  })
})

describe('embeds', () => {
  it('Google Docs: only published docs.google.com links, forced embedded=true', () => {
    expect(docsEmbedUrl('https://docs.google.com/document/d/e/2PACX-1/pub')).toBe('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')
    expect(docsEmbedUrl('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')).toBe('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')
    expect(docsEmbedUrl('https://docs.google.com/document/d/abc/edit')).toBeNull()
    expect(docsEmbedUrl('http://docs.google.com/document/d/e/x/pub')).toBeNull()
    expect(docsEmbedUrl('https://evil.org/docs.google.com/pub')).toBeNull()
    expect(docsEmbedUrl('')).toBeNull()
  })

  it('Telegram: https links on t.me, telegram.me or web.telegram.org only', () => {
    expect(telegramUrl('https://t.me/somegroup')).toBe('https://t.me/somegroup')
    expect(telegramUrl('https://web.telegram.org/k/#@somegroup')).toBe('https://web.telegram.org/k/#@somegroup')
    expect(telegramUrl('t.me/somegroup')).toBe('https://t.me/somegroup')
    expect(telegramUrl('https://t.me.evil.org/x')).toBeNull()
    expect(telegramUrl('javascript:alert(1)')).toBeNull()
  })
})
