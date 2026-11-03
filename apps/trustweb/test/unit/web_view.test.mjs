/** The Web view's pure helpers (web_view.ts): the rings' local point, the tap's nearest ring, the context menu's target and place, the drag threshold and the drop's outcome. */
import { Ring, CLOSENESS_KEY } from '../../src/model.ts'
import { FAMILY_FIELD } from '../../src/rings_layout.ts'
import { HIDDEN_GUIDE_OPACITY, RINGS_SIZE, RING_LINE_HIT, RIPPLE_LEAD_MS, dragStarts, dropOutcome, localPoint, menuPlace, menuTarget, nearestRing } from '../../src/web_view.ts'

const person = (ring, extra = {}) => ({ id: 'p1', name: 'P', context: '', ring, metAt: 0, lines: [], ...extra })
const C = RINGS_SIZE / 2
const radius = { closest: 48, close: 78, friend: 106, acquaintance: 132, intending: 156, unsorted: 176, none: 176, family: 48 }
const geo = { radius, rings: [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending] }

describe('web view helpers', () => {
  it('keeps the constants the rings were drawn with', () => {
    expect(RINGS_SIZE).toBe(352)
    expect(RING_LINE_HIT).toBe(10)
    expect(RIPPLE_LEAD_MS).toBe(360)
    expect(HIDDEN_GUIDE_OPACITY).toBe('.25')
  })

  it('localPoint reads a pointer in layout px, whatever the box is scaled to', () => {
    expect(localPoint({ clientX: 110, clientY: 220 }, { left: 10, top: 20, width: RINGS_SIZE })).toEqual({ x: 100, y: 200 })
    // Half size (the query dock's scale): the same spot on screen is twice as far in layout px.
    expect(localPoint({ clientX: 60, clientY: 70 }, { left: 10, top: 20, width: RINGS_SIZE / 2 })).toEqual({ x: 100, y: 100 })
  })

  it('nearestRing picks the ring whose line is closest, scaled by k', () => {
    expect(nearestRing(50, geo, 1)).toBe(Ring.Closest)
    expect(nearestRing(105, geo, 1)).toBe(Ring.Friend)
    expect(nearestRing(170, geo, 1)).toBe(Ring.Intending)
    expect(nearestRing(78 * 0.5 + 1, geo, 0.5)).toBe(Ring.Close)
  })

  it('nearestRing defaults to acquaintance on a tie and when no ring is measured', () => {
    expect(nearestRing((132 + 156) / 2, geo, 1)).toBe(Ring.Acquaintance)
    expect(nearestRing((106 + 132) / 2, geo, 1)).toBe(Ring.Acquaintance)
    expect(nearestRing(40, { radius: {}, rings: [] }, 1)).toBe(Ring.Acquaintance)
  })

  it('menuTarget is on a line up to RING_LINE_HIT view px from it, on both sides', () => {
    expect(menuTarget({ x: C + 132 + RING_LINE_HIT, y: C }, geo, 1)).toEqual({ near: Ring.Acquaintance, onLine: true })
    expect(menuTarget({ x: C + 132 - RING_LINE_HIT, y: C }, geo, 1)).toEqual({ near: Ring.Acquaintance, onLine: true })
    expect(menuTarget({ x: C + 132 + RING_LINE_HIT + 0.5, y: C }, geo, 1)).toEqual({ near: Ring.Acquaintance, onLine: false })
    expect(menuTarget({ x: C, y: C + 132 - RING_LINE_HIT - 0.5 }, geo, 1)).toEqual({ near: Ring.Acquaintance, onLine: false })
  })

  it('menuTarget reads the ring through k, the hit distance in view px', () => {
    const k = 0.5
    expect(menuTarget({ x: C + 156 * k + RING_LINE_HIT, y: C }, geo, k)).toEqual({ near: Ring.Intending, onLine: true })
    expect(menuTarget({ x: C + 156 * k + RING_LINE_HIT + 1, y: C }, geo, k).onLine).toBe(false)
    expect(menuTarget({ x: C, y: C }, geo, 1)).toEqual({ near: Ring.Closest, onLine: false })
  })

  it('menuPlace keeps the menu inside the rings (170 wide, 70 high)', () => {
    expect(menuPlace({ x: 20, y: 30 })).toEqual({ left: 20, top: 30 })
    expect(menuPlace({ x: 340, y: 340 })).toEqual({ left: RINGS_SIZE - 170, top: RINGS_SIZE - 70 })
    expect(menuPlace({ x: RINGS_SIZE - 170, y: RINGS_SIZE - 71 })).toEqual({ left: 182, top: 281 })
  })

  it('dragStarts: a mouse after 4 px, a held touch after 8 px', () => {
    expect(dragStarts(3.9, 0, false)).toBe(false)
    expect(dragStarts(4, 0, false)).toBe(true)
    expect(dragStarts(3, 4, false)).toBe(true)
    expect(dragStarts(7.9, 0, true)).toBe(false)
    expect(dragStarts(0, 8, true)).toBe(true)
    expect(dragStarts(4, 4, true)).toBe(false)
  })

  it('dropOutcome follows the drop branches in order', () => {
    // Beyond the rings hides, whatever ring was read last.
    expect(dropOutcome(person(Ring.Friend), Ring.Close, true)).toBe('hide')
    expect(dropOutcome(person(Ring.Family), Ring.Unsorted, true)).toBe('hide')
    // A family person dropped on the unsorted ring stays where they are.
    const family = person(Ring.Family, { fields: { [FAMILY_FIELD]: true, [CLOSENESS_KEY]: Ring.Close } })
    expect(dropOutcome(family, Ring.Unsorted, false)).toBe('family-stays')
    expect(dropOutcome(person(Ring.Family), Ring.Unsorted, false)).toBe('family-stays')
    // The same ring keeps the person, only the angle moves.
    expect(dropOutcome(person(Ring.Friend), Ring.Friend, false)).toBe('same-ring')
    expect(dropOutcome(person(Ring.Unsorted), Ring.Unsorted, false)).toBe('same-ring')
    expect(dropOutcome(person(Ring.Friend, { ringSuggested: true }), Ring.Unsorted, false)).toBe('same-ring')
    // Out to the unsorted ring: back to "not placed yet".
    expect(dropOutcome(person(Ring.Friend), Ring.Unsorted, false)).toBe('unplace')
    // Intending first asks how much.
    expect(dropOutcome(person(Ring.Friend), Ring.Intending, false)).toBe('ask-desire')
    // Anything else moves.
    expect(dropOutcome(person(Ring.Friend), Ring.Close, false)).toBe('move')
    expect(dropOutcome(person(Ring.Unsorted), Ring.Acquaintance, false)).toBe('move')
  })
})
