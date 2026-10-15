/** Wave 7: the rings view geometry and a drop on a ring (rings_layout.ts); the older close_friend name reads as close. */
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { DESIRE_DEFAULT, RING_RADIUS, beyondRings, placeOnRing, ringAt, WEB_RINGS, lapRadius, ringsGeometry, webSlot, angleFromCentre, angleOf, packLaps, restoreAngles, spaceOut } from '../../src/rings_layout.ts'
import { parseRecord } from '../../src/store.ts'

const person = (ring, extra = {}) => ({ id: 'p', name: 'P', context: '', ring, metAt: 0, lines: [], ...extra })

describe('rings drag', () => {
  it('close dots leave a clear gap (>= 4 px) to the you avatar (r 20 + 2 px ring) for 1, 3 and 8 people', () => {
    for (const n of [1, 3, 8]) {
      const g = ringsGeometry({ close: n })
      expect(g.radius.close - g.dot.close / 2 - 22).toBeGreaterThanOrEqual(4)
      expect(g.dot.close).toBeLessThanOrEqual(32)
    }
  })
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
  it('only a confirmed ring places a person: a suggested ring (any of the four, or family) stays on the unsorted ring', () => {
    for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Family]) {
      expect(webSlot(person(r, { ringSuggested: true }))).toBe(Ring.Unsorted)
      expect(webSlot(person(r, { ringSuggested: false }))).not.toBe(Ring.Unsorted)
    }
    expect(webSlot(person(Ring.Acquaintance))).toBe(Ring.Acquaintance)
    expect(webSlot(person(Ring.Unsorted, { ringSuggested: true }))).toBe(Ring.Unsorted)
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

  describe('dots keep their angle', () => {
    const at = (id, ring, angle) => person(ring, { id, ...(angle === undefined ? {} : { angle }) })
    const sheetOf = (people) => {
      const members = {}
      for (const p of people) (members[webSlot(p)] ??= []).push(p)
      const counts = Object.fromEntries(Object.entries(members).map(([r, ps]) => [r, ps.length]))
      const g = ringsGeometry(counts, Object.fromEntries(Object.entries(members).map(([r, ps]) => [r, ps.map(angleOf)])))
      return Object.fromEntries(Object.entries(members).flatMap(([r, ps]) => ps.map((p, i) => [p.id, [angleOf(p), g.lapOf[r][i]]])))
    }
    it('reads the angle from the centre: 0 at the top, clockwise', () => {
      expect(angleFromCentre(0, -5)).toBe(0)
      expect(angleFromCentre(5, 0)).toBe(90)
      expect(angleFromCentre(0, 5)).toBe(180)
      expect(angleFromCentre(-5, 0)).toBe(270)
    })
    it('a stored angle wins; without one the angle is fixed by the id', () => {
      expect(angleOf({ id: 'x', angle: 123 })).toBe(123)
      expect(angleOf({ id: 'x' })).toBe(angleOf({ id: 'x' }))
      expect(angleOf({ id: 'x' })).not.toBe(angleOf({ id: 'y' }))
      expect(angleOf({ id: 'x' })).toBeGreaterThanOrEqual(0)
      expect(angleOf({ id: 'x' })).toBeLessThan(360)
    })
    it('the same input twice gives the same positions; adding a person moves no one else', () => {
      const people = [at('a', Ring.Friend, 10), at('b', Ring.Friend, 200), at('c', Ring.Friend)]
      expect(sheetOf(people)).toEqual(sheetOf(people))
      const before = sheetOf(people)
      const after = sheetOf([...people, at('d', Ring.Friend, 15), at('e', Ring.Friend)])
      for (const id of ['a', 'b', 'c']) expect(after[id]).toEqual(before[id])
    })
    it('a dot dropped on top of another takes the next lap, not its spot', () => {
      expect(packLaps([10, 10, 190], 84, 30)).toEqual([0, 1, 0])
    })
    it('spaceOut gives equal gaps, keeps the order and the first dot, per ring or all', () => {
      const s = { people: [at('a', Ring.Close, 300), at('b', Ring.Close, 20), at('c', Ring.Close, 40), at('d', Ring.Friend, 5), at('e', Ring.Friend, 6)] }
      const before = spaceOut(s, Ring.Close)
      expect([s.people[1], s.people[2], s.people[0]].map((p) => p.angle)).toEqual([20, 140, 260])
      expect(s.people[3].angle).toBe(5)
      expect([...before.keys()].sort()).toEqual(['a', 'b', 'c'])
      spaceOut(s)
      expect([s.people[3].angle, s.people[4].angle]).toEqual([5, 185])
    })
    it('restoreAngles puts every angle back, including none', () => {
      const s = { people: [at('a', Ring.Close, 300), at('b', Ring.Close)] }
      restoreAngles(s, spaceOut(s))
      expect(s.people[0].angle).toBe(300)
      expect('angle' in s.people[1]).toBe(false)
    })
  })
})
