/** Wave 7: the rings view geometry and a drop on a ring (rings_layout.ts); the older close_friend name reads as close. */
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { DESIRE_DEFAULT, RING_RADIUS, inContact, placeOnRing, ringAt, WEB_RINGS, lapRadius, ringsGeometry } from '../../src/rings_layout.ts'
import { parseRecord } from '../../src/store.ts'

const person = (ring, extra = {}) => ({ id: 'p', name: 'P', context: '', ring, metAt: 0, lines: [], ...extra })

describe('rings drag', () => {
  it('orders the rings from the centre and reads a drop from the distance', () => {
    expect(RING_RADIUS.close < RING_RADIUS.friend && RING_RADIUS.friend < RING_RADIUS.acquaintance).toBe(true)
    expect(RING_RADIUS.acquaintance < RING_RADIUS.intending && RING_RADIUS.intending < RING_RADIUS.unsorted).toBe(true)
    expect(ringAt(0)).toBe(Ring.Close)
    expect(ringAt(RING_RADIUS.intending + 3)).toBe(Ring.Intending)
    expect(ringAt(500)).toBe(Ring.Unsorted)
  })
  it('a full ring continues on laps outside it and pushes the rings beyond it outward, never inward', () => {
    const few = ringsGeometry({ close: 3, unsorted: 2 })
    expect(few.radius.acquaintance).toBe(RING_RADIUS.acquaintance)
    expect(few.perLap.close).toBeGreaterThanOrEqual(3)
    const g = ringsGeometry({ close: 7, friend: 15, acquaintance: 255, unsorted: 238 })
    expect(g.dot.acquaintance).toBe(14)
    expect(g.radius.close).toBe(RING_RADIUS.close)
    expect(lapRadius(g, Ring.Acquaintance, 2)).toBeGreaterThan(g.radius.acquaintance)
    expect(g.radius.intending).toBeGreaterThan(lapRadius(g, Ring.Acquaintance, Math.ceil(255 / g.perLap.acquaintance) - 1))
    expect(g.radius.unsorted).toBeGreaterThan(g.radius.intending)
  })
  it('the rings are close friend, friend, acquaintance, intending to connect, unsorted: no contact tier', () => {
    expect(WEB_RINGS).toEqual([Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted])
    expect(Object.values(Ring).some((r) => /contact/i.test(r))).toBe(false)
    expect(Object.values(S.ringLabel).some((l) => /contact/i.test(l.replace('Intending to connect', '')))).toBe(false)
  })
  it('a drop sets the ring; intending carries a clamped 0..10 value and a date, leaving it clears both', () => {
    const p = person(Ring.Friend)
    placeOnRing(p, Ring.Intending, 7)
    expect(p).toMatchObject({ ring: Ring.Intending, intending: { value: DESIRE_DEFAULT, since: 7 } })
    placeOnRing(p, Ring.Intending, 8, 40)
    expect(p.intending).toEqual({ value: 10, since: 8 })
    placeOnRing(p, Ring.Close, 9)
    expect(p.ring).toBe(Ring.Close)
    expect(p.intending).toBeUndefined()
  })
  it('family keeps its tag and moves by closeness; unsorted ends it', () => {
    const p = person(Ring.Family)
    placeOnRing(p, Ring.Acquaintance, 1)
    expect(p.ring).toBe(Ring.Family)
    expect(p.fields[CLOSENESS_KEY]).toBe(Ring.Acquaintance)
    placeOnRing(p, Ring.Unsorted, 2)
    expect(p.ring).toBe(Ring.Unsorted)
  })
  it('reads the older close_friend value as close', () => {
    const rec = { v: 1, me: { id: 'm' }, people: [person('close_friend')], peers: [] }
    expect(parseRecord(JSON.stringify(rec)).people[0].ring).toBe(Ring.Close)
  })
  it('established contact: a met date, notes or a recorded meeting', () => {
    expect(inContact(person(Ring.Unsorted))).toBe(false)
    expect(inContact(person(Ring.Unsorted, { metAt: 5 }))).toBe(true)
    expect(inContact(person(Ring.Unsorted, { lines: [{}] }))).toBe(true)
    expect(inContact(person(Ring.Unsorted, { generalNote: ' ' }))).toBe(false)
    expect(inContact(person(Ring.Unsorted), [{ personId: 'p' }])).toBe(true)
  })
})
