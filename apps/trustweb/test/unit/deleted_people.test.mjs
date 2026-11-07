// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Reversible delete (src/deleted_people.ts). */
import { alive, daysLeft, deletePersonSoft, isDeleted, purgeDue, putBack, recentlyDeleted } from '../../src/deleted_people.ts'
import { Ring } from '../../src/model.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-07T12:00:00Z')
const person = (id, extra = {}) => ({ id, name: id, ring: Ring.Friend, angle: 1.2, ...extra })
const deletedAgo = (id, days) => person(id, { ring: Ring.None, prevRing: Ring.Friend, deleted_at: new Date(NOW - days * DAY).toISOString() })

describe('deleted people', () => {
  it('a delete keeps everything, files the person under none and stamps the time', () => {
    const p = person('a')
    deletePersonSoft(p, NOW)
    expect(p).toMatchObject({ id: 'a', angle: 1.2, ring: Ring.None, prevRing: Ring.Friend, deleted_at: '2026-11-07T12:00:00.000Z' })
    expect(isDeleted(p)).toBe(true)
  })
  it('a second delete changes nothing (the 30 days do not restart)', () => {
    const p = deletedAgo('a', 5)
    const before = { ...p }
    deletePersonSoft(p, NOW)
    expect(p).toEqual(before)
  })
  it('alive leaves the deleted out', () => {
    expect(alive([person('a'), deletedAgo('b', 1)]).map((p) => p.id)).toEqual(['a'])
  })
  it('put back restores the ring and clears the stamp', () => {
    const p = deletedAgo('a', 3)
    putBack(p)
    expect(p.ring).toBe(Ring.Friend)
    expect(p.prevRing).toBeUndefined()
    expect(p.deleted_at).toBeUndefined()
  })
  it('put back without a remembered ring: not yet sorted', () => {
    const p = { id: 'a', ring: Ring.None, deleted_at: 'x' }
    putBack(p)
    expect(p.ring).toBe(Ring.Unsorted)
  })
  it('counts the days left', () => {
    expect(daysLeft(deletedAgo('a', 0), NOW)).toBe(30)
    expect(daysLeft(deletedAgo('a', 10.5), NOW)).toBe(20)
    expect(daysLeft(deletedAgo('a', 40), NOW)).toBe(0)
  })
  it('purge: 29 days stay, 31 days go', () => {
    const s = { people: [person('live'), deletedAgo('d29', 29), deletedAgo('d31', 31)] }
    expect(purgeDue(s, NOW)).toEqual(['d31'])
  })
  it('recently deleted lists the ones inside 30 days, newest first', () => {
    const people = [deletedAgo('old', 29), deletedAgo('gone', 31), person('live'), deletedAgo('new', 1)]
    expect(recentlyDeleted(people, NOW).map((p) => p.id)).toEqual(['new', 'old'])
  })
})

describe('delete from the person page (wave 36b)', () => {
  it('a page delete is the tombstone: deleted_at set, the person stays in people', () => {
    const people = [person('a'), person('b')]
    deletePersonSoft(people[0], NOW)
    expect(people).toHaveLength(2)
    expect(people[0].deleted_at).toBe('2026-11-07T12:00:00.000Z')
    expect(alive(people).map((p) => p.id)).toEqual(['b'])
  })
})
