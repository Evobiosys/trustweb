// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Zone/card page (wave 29): which categories make my resources visible to one person, and the line that names them. */
import { Audience, Provenance, Ring } from '../../src/model.ts'
import { andJoin, kindKey, visibleVia } from '../../src/zone_visibility.ts'
import { S } from '../../src/strings.ts'

const item = (id, audience, extra = {}) => ({ id, text: id, audience, included: true, createdAt: 1, ...extra })
const labels = { zone: 'Friends & acquainted community members', web: 'everyone in your web' }
const tags = [{ id: 'climb', label: 'climbing' }, { id: 'fam', label: 'family' }]

describe('visibleVia', () => {
  it('groups by the category that grants: the zone, everyone in your web, each tag', () => {
    const inv = [item('a', Audience.Friends), item('b', Audience.FriendsOfFriends), item('c', Audience.OnlyMe, { tagAudience: ['climb'] }), item('d', Audience.Close)]
    const r = visibleVia(inv, Ring.Friend, tags, labels)
    expect(r.categories.map((c) => [c.key, c.label, c.items.map((i) => i.id)])).toEqual([
      ['zone', labels.zone, ['a']],
      ['web', labels.web, ['b']],
      ['tag:climb', 'climbing', ['c']],
    ])
    expect(r.count).toBe(3)
  })
  it('counts an item once when two categories grant it, and lists it under both', () => {
    const r = visibleVia([item('a', Audience.Friends, { tagAudience: ['fam'] })], Ring.Friend, tags, labels)
    expect(r.categories.map((c) => c.key)).toEqual(['zone', 'tag:fam'])
    expect(r.count).toBe(1)
  })
  it('skips excluded items, tags the person lacks and empty categories', () => {
    const inv = [item('a', Audience.Friends, { included: false }), item('b', Audience.OnlyMe, { tagAudience: ['other'] })]
    expect(visibleVia(inv, Ring.Friend, tags, labels)).toEqual({ count: 0, categories: [] })
  })
  it('shows nothing to an intending person', () => {
    expect(visibleVia([item('a', Audience.FriendsOfFriends)], Ring.Intending, [], labels).count).toBe(0)
  })
})

describe('andJoin and the line', () => {
  it('joins 1, 2 and 3 with the and only before the last', () => {
    expect(andJoin(['X'])).toBe('X')
    expect(andJoin(['X', 'Y'])).toBe('X and Y')
    expect(andJoin(['X', 'Y', 'Z'])).toBe('X, Y, and Z')
  })
  it('names the categories in the sentence', () => {
    expect(S.cardSharesVia(5, andJoin(['A', 'B']))).toBe('5 resources are visible to them based on A and B')
    expect(S.cardSharesVia(1, 'A')).toBe('1 resource is visible to them based on A')
  })
})

describe('kindKey', () => {
  it('maps provenance to a kind word, typed when unknown', () => {
    expect(kindKey(Provenance.RecordedMeeting)).toBe('recorded')
    expect(kindKey(Provenance.Tana)).toBe('imported')
    expect(kindKey(undefined)).toBe('typed')
  })
})
