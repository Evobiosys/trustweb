// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the closest five per membrane (membranes_five.ts). */
import { ChatDirection } from '../../src/chat.ts'
import { Audience, Ring } from '../../src/model.ts'
import { LIMIT_DEFAULT, limitOf, parseLimit, pickFive, pinnedFrom, recency, repairPinned, sharedCount, slotAngle, withTag } from '../../src/membranes_five.ts'

const NOW = Date.UTC(2026, 9, 29, 12, 0)
const person = (id, o = {}) => ({ id, name: id, context: '', ring: Ring.Friend, metAt: 0, ...o })
const chat = (at) => ({ messages: [{ dir: ChatDirection.In, at, text: 'x' }], unread: 0 })

describe('recency', () => {
  it('is the newest of chat, connect time, timeline, meeting; absent = 0', () => {
    expect(recency({}, person('a'), NOW)).toBe(0)
    expect(recency({}, person('a', { metAt: 5 }), NOW)).toBe(5)
    expect(recency({ chats: { pe: chat(9) } }, person('a', { metAt: 5, peerId: 'pe' }), NOW)).toBe(9)
    expect(recency({ meetings: [{ personId: 'a', startedAt: 20, endedAt: 30 }] }, person('a', { metAt: 5 }), NOW)).toBe(30)
  })
  it('ignores the shared engagement baseline so it never flattens the order', () => {
    expect(recency({ engagementSince: 1000 }, person('a', { metAt: 5 }), NOW)).toBe(5)
  })
})

describe('pickFive', () => {
  const s = { chats: { pa: chat(300), pb: chat(100) } }
  const a = person('a', { peerId: 'pa' }); const b = person('b', { peerId: 'pb' }); const c = person('c', { metAt: 200 }); const d = person('d')
  it('orders by recency and cuts at the limit', () => {
    const r = pickFive([d, b, c, a], s, 2, NOW)
    expect(r.shown.map((p) => p.id)).toEqual(['a', 'c'])
    expect(r.rest.map((p) => p.id)).toEqual(['b', 'd'])
  })
  it('pinned come first, then recency', () => {
    const r = pickFive([a, b, d], s, 2, NOW)
    expect(r.shown.map((p) => p.id)).toEqual(['a', 'b'])
    const f = pickFive([a, b, { ...d, pinned: true }], s, 2, NOW)
    expect(f.shown.map((p) => p.id)).toEqual(['d', 'a'])
  })
  it('equal recency keeps a stable order by id', () => {
    expect(pickFive([person('z'), person('y')], {}, 5, NOW).shown.map((p) => p.id)).toEqual(['y', 'z'])
  })
  it('limit larger than the ring shows all, empty rest', () => {
    expect(pickFive([a], s, 5, NOW).rest).toEqual([])
  })
})

describe('slotAngle', () => {
  it('first five sit clockwise at 1:30 4:30 6:00 7:30 10:30', () => {
    expect([0, 1, 2, 3, 4].map((i) => slotAngle(i, 5))).toEqual([45, 135, 180, 225, 315])
  })
  it('beyond five: the extra ones spread evenly, offset half a gap', () => {
    expect([5, 6, 7].map((i) => slotAngle(i, 8))).toEqual([60, 180, 300])
  })
  it('fewer than five people still take the first slots', () => {
    expect([0, 1].map((i) => slotAngle(i, 2))).toEqual([45, 135])
  })
})

describe('limit', () => {
  it('absent = 5; junk = 5; clamped 1..20', () => {
    expect(LIMIT_DEFAULT).toBe(5)
    expect(limitOf({})).toBe(5)
    expect(limitOf({ membraneLimit: 'x' })).toBe(5)
    expect(limitOf({ membraneLimit: 8 })).toBe(8)
    expect(limitOf({ membraneLimit: 99 })).toBe(20)
  })
  it('the settings field: junk keeps (null), whole numbers 1..20', () => {
    expect(parseLimit('')).toBeNull()
    expect(parseLimit('abc')).toBeNull()
    expect(parseLimit('0')).toBe(1)
    expect(parseLimit('7.9')).toBe(7)
    expect(parseLimit('50')).toBe(20)
  })
})

describe('withTag', () => {
  it('keeps people holding the tag; no tag keeps all', () => {
    const a = person('a', { fields: { t1: 'true' } }); const b = person('b')
    expect(withTag([a, b], 't1').map((p) => p.id)).toEqual(['a'])
    expect(withTag([a, b], null)).toHaveLength(2)
  })
})

describe('sharedCount', () => {
  it('counts included items whose audience admits the person ring', () => {
    const s = { inventory: [
      { id: '1', text: 'x', audience: Audience.Friends, included: true, createdAt: 0 },
      { id: '2', text: 'y', audience: Audience.Close, included: true, createdAt: 0 },
      { id: '3', text: 'z', audience: Audience.Friends, included: false, createdAt: 0 },
    ] }
    expect(sharedCount(s, person('a', { ring: Ring.Friend }))).toBe(1)
    expect(sharedCount(s, person('a', { ring: Ring.Close }))).toBe(2)
    expect(sharedCount(s, person('a', { ring: Ring.Unsorted }))).toBe(0)
  })
})

describe('favourite -> pinned', () => {
  it('pinnedFrom renames an old favourite and never overrides pinned', () => {
    expect(pinnedFrom({ name: 'a', favourite: true })).toEqual({ name: 'a', pinned: true })
    expect(pinnedFrom({ name: 'a', favourite: true, pinned: true })).toEqual({ name: 'a', pinned: true })
    const same = { name: 'a' }
    expect(pinnedFrom(same)).toBe(same)
  })
  it('repairPinned migrates a record once', () => {
    const s = { people: [{ id: 'a', favourite: true }, { id: 'b' }] }
    expect(repairPinned(s)).toBe(true)
    expect(s.people).toEqual([{ id: 'a', pinned: true }, { id: 'b' }])
    expect(repairPinned(s)).toBe(false)
  })
})
