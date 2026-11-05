// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 card-inventory: what we know of a person's resources, and the "recent" mark shared with my own list. */
import { RECENT_DAYS, addPeerItem, peerItems, recentMark } from '../../src/peer_items.ts'

const DAY = 86_400_000

describe('recentMark', () => {
  const now = 100 * DAY
  it('is true under 30 days, false at 30 days and older, false without a date', () => {
    expect(RECENT_DAYS).toBe(30)
    expect(recentMark(now - 29 * DAY, now)).toBe(true)
    expect(recentMark(now - 30 * DAY, now)).toBe(false)
    expect(recentMark(undefined, now)).toBe(false)
  })
  it('treats a date in the future as recent (clock skew)', () => expect(recentMark(now + DAY, now)).toBe(true))
})

describe('peerItems', () => {
  const line = (personId, title, at) => ({ kind: 'peer_item', personId, title, category: '', source: 'self', at })
  it('returns only that person\'s lines, newest first; none when the record has none', () => {
    const rec = { peerItems: [line('a', 'drill', 1), line('b', 'ladder', 2), line('a', 'saw', 3)] }
    expect(peerItems(rec, 'a').map((i) => i.title)).toEqual(['saw', 'drill'])
    expect(peerItems({}, 'a')).toEqual([])
  })
})

describe('addPeerItem', () => {
  it('appends a trimmed peer_item line and ignores an empty title', () => {
    const rec = {}
    expect(addPeerItem(rec, 'a', '  drill ', ' tools ', 'self', 5)).toEqual({ kind: 'peer_item', personId: 'a', title: 'drill', category: 'tools', source: 'self', at: 5 })
    expect(rec.peerItems).toHaveLength(1)
    expect(addPeerItem(rec, 'a', '   ', '', 'self', 6)).toBeNull()
    expect(rec.peerItems).toHaveLength(1)
  })
})
