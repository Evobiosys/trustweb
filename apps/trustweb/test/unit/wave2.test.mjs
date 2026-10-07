/**
 * Wave 2 (2026-10-07), the pure parts:
 *   item 4 (P22, P26): who can ask about a line: the three tiers and "Only me";
 *     each tier admits itself and everyone closer; an unknown value admits nobody.
 */
import { Audience, AUDIENCES, audienceAdmits, LineStatus, Ring, threadsForRing } from '../../src/model.ts'

const NOW = Date.UTC(2026, 9, 7, 10, 0, 0)

function phone(inventory, lines = []) {
  return {
    v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false,
    inventory,
    people: [{ id: 'p1', name: 'Kaya', context: 'Impact Hub', ring: Ring.Friend, metAt: NOW, lines }],
  }
}
const item = (id, audience, included = true) => ({ id, text: `thing ${id}`, audience, included, createdAt: NOW })
const matched = (s, ring) => threadsForRing(s, ring).threads.map((t) => t.id).sort()

describe('item 4: the three tiers and "Only me"', () => {
  it('offers all four, widest first', () => {
    expect(AUDIENCES).toEqual([Audience.FriendsOfFriends, Audience.Friends, Audience.Close, Audience.OnlyMe])
    expect(new Set(AUDIENCES).size).toBe(4)
  })
  it('each tier admits itself and everyone closer; Only me admits nobody; someone you only plan to meet, nothing', () => {
    const table = {
      [Audience.FriendsOfFriends]: { close: true, friend: true, acquaintance: true, intending: false },
      [Audience.Friends]: { close: true, friend: true, acquaintance: false, intending: false },
      [Audience.Close]: { close: true, friend: false, acquaintance: false, intending: false },
      [Audience.OnlyMe]: { close: false, friend: false, acquaintance: false, intending: false },
    }
    for (const a of AUDIENCES) for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]) {
      expect([a, r, audienceAdmits(a, r)]).toEqual([a, r, table[a][r]])
    }
  })
  it('a value this build does not know admits nobody (fail closed), as an older build reads "close"', () => {
    for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance]) expect(audienceAdmits('someday', r)).toBe(false)
  })
  it('what an asker is matched against follows the tier, for things and for notes about people', () => {
    const s = phone(
      [item('a', Audience.FriendsOfFriends), item('f', Audience.Friends), item('c', Audience.Close), item('m', Audience.OnlyMe), item('off', Audience.FriendsOfFriends, false)],
      [{ id: 'l1', text: 'Offers a body-work session', tag: 'offer', audience: Audience.Close, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW }],
    )
    expect(matched(s, Ring.Acquaintance)).toEqual(['inv:a'])
    expect(matched(s, Ring.Friend)).toEqual(['inv:a', 'inv:f'])
    expect(matched(s, Ring.Close).length).toBe(4)
    expect(matched(s, Ring.Close)).toContain('inv:c')
    expect(matched(s, Ring.Close).some((id) => id.includes('l1'))).toBe(true)
    expect(matched(s, Ring.Friend).some((id) => id.includes('l1'))).toBe(false)
  })
})
