// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 card-resources-edit: rename a resource and add one in a category from the person card. */
import { addResourceIn, categoryAudience, renameResource } from '../../src/resource_edit.ts'
import { Audience } from '../../src/model.ts'

const item = (id, text, audience = Audience.Friends, extra = {}) => ({ id, text, audience, included: true, createdAt: 1, ...extra })

describe('renameResource', () => {
  it('saves the trimmed title and says so', () => {
    const rec = { inventory: [item('a', 'ladder')] }
    expect(renameResource(rec, 'a', '  tall ladder ')).toBe(true)
    expect(rec.inventory[0].text).toBe('tall ladder')
  })
  it('empty, unchanged or unknown id: nothing saved', () => {
    const rec = { inventory: [item('a', 'ladder')] }
    expect(renameResource(rec, 'a', '   ')).toBe(false)
    expect(renameResource(rec, 'a', 'ladder')).toBe(false)
    expect(renameResource(rec, 'zz', 'x')).toBe(false)
    expect(rec.inventory[0].text).toBe('ladder')
  })
})

describe('categoryAudience', () => {
  it('web is everyone, a tag keeps the rings closed, the zone follows its first item', () => {
    expect(categoryAudience({ key: 'web', items: [] })).toBe(Audience.FriendsOfFriends)
    expect(categoryAudience({ key: 'tag:t1', items: [item('a', 'x')] })).toBe(Audience.OnlyMe)
    expect(categoryAudience({ key: 'zone', items: [item('a', 'x', Audience.Close)] })).toBe(Audience.Close)
  })
})

describe('addResourceIn', () => {
  it('adds a typed resource with the category audience', () => {
    const rec = { inventory: [] }
    const it = addResourceIn(rec, { key: 'web', items: [] }, ' drill ', 'n1', 5)
    expect(rec.inventory).toEqual([it])
    expect(it).toMatchObject({ id: 'n1', text: 'drill', audience: Audience.FriendsOfFriends, included: true, createdAt: 5 })
  })
  it('a tag category stores the tag id', () => {
    const rec = { inventory: [] }
    const it = addResourceIn(rec, { key: 'tag:t1', items: [] }, 'saw', 'n2', 5)
    expect(it.tagAudience).toEqual(['t1'])
    expect(it.audience).toBe(Audience.OnlyMe)
  })
  it('empty title adds nothing', () => {
    const rec = { inventory: [] }
    expect(addResourceIn(rec, { key: 'web', items: [] }, '  ', 'n3', 5)).toBeNull()
    expect(rec.inventory).toEqual([])
  })
})
