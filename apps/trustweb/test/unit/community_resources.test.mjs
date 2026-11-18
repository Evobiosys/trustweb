// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44c community-resources: scope of the Resources/References lists to a community or an event, the three sections, tag chips (src/resource_scope.ts). */
import { scopeOf, itemTags, partitionScope, forPage, markOpened, scopedList } from '../../src/resource_scope.ts'
import { NAV, menuItems } from '../../src/ext/community-mighty/community_data.ts'

const it1 = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
const tags = [
  { id: 'c1', colour: '#111', label: 'Forum', community: true },
  { id: 'c2', colour: '#222', label: 'Other', community: true },
  { id: 'plain', colour: '#333', label: 'Garden' },
]
const events = [{ id: 'e1', name: 'Summer Camp', tagName: 'Summer Camp' }]
const et = { slug: (n) => `event_${n.replace(/\s+/g, '_')}`, label: (n) => `#event:${n}` }

describe('scopeOf', () => {
  it('is null without a filter', () => { expect(scopeOf({ uiRings: {} }, tags, events, et)).toBeNull() })
  it('names the one community chip', () => {
    expect(scopeOf({ uiRings: { show: ['tag:c1'] } }, tags, events, et)).toMatchObject({ kind: 'community', id: 'c1', label: 'Forum' })
  })
  it('ignores the bare community chip, two communities and plain tags', () => {
    expect(scopeOf({ uiRings: { show: ['community'] } }, tags, events, et)).toBeNull()
    expect(scopeOf({ uiRings: { show: ['tag:c1', 'tag:c2'] } }, tags, events, et)).toBeNull()
    expect(scopeOf({ uiRings: { show: ['tag:plain'] } }, tags, events, et)).toBeNull()
  })
  it('event mode wins and carries the event tag', () => {
    const sc = scopeOf({ uiRings: { show: ['tag:c1'], eventMode: 'e1' }, events }, tags, events, et)
    expect(sc).toMatchObject({ kind: 'event', id: 'e1' })
    expect(sc.label).toBe('#event:Summer Camp')
  })
})

describe('itemTags', () => {
  it('lists tagAudience, community and event once each, skipping unknown ids', () => {
    const i = it1('a', { tagAudience: ['plain', 'c1', 'gone'], communityId: 'c1', eventId: 'e1' })
    expect(itemTags(i, tags, events, et).map((t) => t.label)).toEqual(['Garden', 'Forum', '#event:Summer Camp'])
  })
  it('is empty for an untagged item', () => { expect(itemTags(it1('a'), tags, events, et)).toEqual([]) })
})

describe('partitionScope', () => {
  const community = { kind: 'community', id: 'c1', label: 'Forum' }
  const items = [
    it1('mine-tag', { tagAudience: ['c1'], createdAt: 5 }),
    it1('mine-comm', { communityId: 'c1', createdAt: 4 }),
    it1('mine-other', { tagAudience: ['plain'] }),
    it1('mine-none'),
    it1('new-old', { sharedBy: 'p', tagAudience: ['c1'], createdAt: 10 }),
    it1('new-new', { sharedBy: 'p', communityId: 'c1', createdAt: 20 }),
    it1('seen', { sharedBy: 'p', communityId: 'c1', openedAt: 30, createdAt: 15 }),
    it1('other-comm', { sharedBy: 'p', communityId: 'c2' }),
  ]
  it('splits into shared by me, new, general', () => {
    const p = partitionScope(items, community)
    expect(p.shared.map((i) => i.id)).toEqual(['mine-tag', 'mine-comm', 'seen'])
    expect(p.fresh.map((i) => i.id)).toEqual(['new-new', 'new-old'])
    expect(p.general.map((i) => i.id)).toEqual(['mine-other', 'mine-none'])
  })
  it('an event scope takes eventId or the event tag', () => {
    const ev = { kind: 'event', id: 'e1', label: '#event:Summer Camp', tagIds: ['event_Summer_Camp'] }
    const p = partitionScope([it1('a', { eventId: 'e1' }), it1('b', { tagAudience: ['event_Summer_Camp'] }), it1('c')], ev)
    expect(p.shared.map((i) => i.id)).toEqual(['a', 'b'])
    expect(p.general.map((i) => i.id)).toEqual(['c'])
  })
  it('every item lands in exactly one section', () => {
    const p = partitionScope(items, community)
    expect(p.shared.length + p.fresh.length + p.general.length).toBe(items.length - 1)   // other-comm is another community's, not mine to show
  })
})

describe('forPage', () => {
  it('references = kind reference, resources = the rest', () => {
    const l = [it1('a', { kind: 'reference' }), it1('b', { kind: 'book' }), it1('c')]
    expect(forPage(l, 'references').map((i) => i.id)).toEqual(['a'])
    expect(forPage(l, 'resources').map((i) => i.id)).toEqual(['b', 'c'])
  })
})

describe('markOpened', () => {
  it('stamps once', () => {
    const i = it1('a', { sharedBy: 'p' })
    expect(markOpened([i], 'a', 7)).toBe(true)
    expect(markOpened([i], 'a', 9)).toBe(false)
    expect(i.openedAt).toBe(7)
    expect(markOpened([i], 'zzz', 9)).toBe(false)
  })
})

describe('scopedList (MCP)', () => {
  const items = [it1('a', { tagAudience: ['c1'] }), it1('b', { sharedBy: 'p', communityId: 'c1' }), it1('c')]
  it('community needs its id', () => { expect(() => scopedList(items, tags, [], et, { scope: 'community' })).toThrow(/community/) })
  it('returns the three sections as ids', () => {
    expect(scopedList(items, tags, [], et, { scope: 'community', community: 'c1' })).toMatchObject({ title: 'Forum', sections: { shared: ['a'], new: ['b'], general: ['c'] } })
  })
  it('mine is everything, event needs an event, unknown scope throws', () => {
    expect(scopedList(items, tags, [], et, { scope: 'mine' })).toBeNull()
    expect(() => scopedList(items, tags, events, et, { scope: 'event' })).toThrow(/event/)
    expect(() => scopedList(items, tags, events, et, { scope: 'x' })).toThrow(/scope/)
    expect(scopedList([it1('x', { eventId: 'e1' })], tags, events, et, { scope: 'event', event: 'e1' }).sections.shared).toEqual(['x'])
  })
})

describe('community menu', () => {
  it('has Resources and References', () => {
    expect(NAV).toContain('resources')
    expect(NAV).toContain('references')
    const m = menuItems({}, null)
    expect(m).toContain('resources')
    expect(m).toContain('references')
  })
})
