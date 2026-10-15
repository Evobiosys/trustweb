/** Wave 7: the rings view geometry and a drop on a ring (rings_layout.ts); the older close_friend name reads as close. */
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { DESIRE_DEFAULT, RING_RADIUS, beyondRings, placeOnRing, ringAt, WEB_RINGS, lapRadius, ringsGeometry, webSlot } from '../../src/rings_layout.ts'
import { parseRecord } from '../../src/store.ts'

const person = (ring, extra = {}) => ({ id: 'p', name: 'P', context: '', ring, metAt: 0, lines: [], ...extra })

describe('rings drag', () => {
  it('orders the rings from the centre and reads a drop from the distance', () => {
    expect(RING_RADIUS.close < RING_RADIUS.friend && RING_RADIUS.friend < RING_RADIUS.acquaintance).toBe(true)
    expect(RING_RADIUS.acquaintance < RING_RADIUS.intending).toBe(true)
    expect(ringAt(0)).toBe(Ring.Close)
    expect(ringAt(RING_RADIUS.intending + 3)).toBe(Ring.Intending)
    expect(ringAt(500)).toBe(Ring.Unsorted)
    expect(ringAt(500, RING_RADIUS, [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending])).toBe(Ring.Intending)
  })
  it('a full ring continues on laps outside it and pushes the rings beyond it outward, never inward', () => {
    const few = ringsGeometry({ close: 3, intending: 2 })
    expect(few.radius.acquaintance).toBe(RING_RADIUS.acquaintance)
    expect(few.perLap.close).toBeGreaterThanOrEqual(3)
    const g = ringsGeometry({ close: 7, friend: 15, acquaintance: 255, intending: 238 })
    expect(g.dot.acquaintance).toBe(14)
    expect(g.radius.close).toBe(RING_RADIUS.close)
    expect(lapRadius(g, Ring.Acquaintance, 2)).toBeGreaterThan(g.radius.acquaintance)
    expect(g.radius.intending).toBeGreaterThan(lapRadius(g, Ring.Acquaintance, Math.ceil(255 / g.perLap.acquaintance) - 1))
  })
  it('four placed rings and a grey unsorted ring outside them; no contact tier', () => {
    expect(WEB_RINGS).toEqual([Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted])
    expect(Object.values(Ring).some((r) => /contact/i.test(r))).toBe(false)
    expect(Object.values(S.ringLabel).some((l) => /contact/i.test(l.replace('Intending to connect', '')))).toBe(false)
  })
  it('the unsorted ring is drawn and dropped on only when someone is on it, between intending and the hide zone', () => {
    const none = ringsGeometry({ close: 3 })
    expect(none.rings).not.toContain(Ring.Unsorted)
    const g = ringsGeometry({ close: 3, unsorted: 5 })
    expect(g.rings).toContain(Ring.Unsorted)
    expect(g.radius.unsorted).toBeGreaterThan(g.radius.intending)
    expect(ringAt(g.radius.unsorted + 2, g.radius, g.rings)).toBe(Ring.Unsorted)
    expect(ringAt(g.radius.unsorted + 2, g.radius, none.rings)).toBe(Ring.Intending)
    expect(beyondRings(g.radius.unsorted + 2, g)).toBe(false)
    expect(beyondRings(g.extent + 13, g)).toBe(true)
  })
  it('none, unsorted and no ring at all are drawn on the unsorted ring; family sits by closeness', () => {
    for (const r of [Ring.None, Ring.Unsorted, undefined]) expect(webSlot(person(r))).toBe(Ring.Unsorted)
    expect(webSlot(person(Ring.Friend))).toBe(Ring.Friend)
    expect(webSlot(person(Ring.Family))).toBe(Ring.Close)
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
  it('family keeps its tag and moves by closeness', () => {
    const p = person(Ring.Family)
    placeOnRing(p, Ring.Acquaintance, 1)
    expect(p.ring).toBe(Ring.Family)
    expect(p.fields[CLOSENESS_KEY]).toBe(Ring.Acquaintance)
  })
  it('a drop beyond the outermost avatar hides, one on the outer ring does not', () => {
    const g = ringsGeometry({ close: 3, intending: 2 })
    expect(beyondRings(RING_RADIUS.intending, g)).toBe(false)
    expect(beyondRings(g.extent + 13, g)).toBe(true)
  })
  it('reads the older close_friend value as close', () => {
    const rec = { v: 1, me: { id: 'm' }, people: [person('close_friend')], peers: [] }
    expect(parseRecord(JSON.stringify(rec)).people[0].ring).toBe(Ring.Close)
  })
})
