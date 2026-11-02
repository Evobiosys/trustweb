// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Web view's interaction code moved out of main.ts (src/web_view.ts): geometry reads, hidden rings, the space-out menu, the drag. */
import { Ring } from '../../src/model.ts'
import { RINGS_HIDDEN_KEY } from '../../src/rings_hide.ts'
import { ringsGeometry } from '../../src/rings_layout.ts'
import {
  HIDDEN_GUIDE_OPACITY, RINGS_SIZE, RING_LINE_HIT, dragOnRings, dropTargetAt, loadHiddenRings, localPoint, nearestRing, ringNear, ringsLayout, ringsMenuOn, setRingsLayout,
} from '../../src/web_view.ts'

const geo = ringsGeometry({ [Ring.Closest]: 2, [Ring.Close]: 2, [Ring.Friend]: 2, [Ring.Acquaintance]: 2, [Ring.Intending]: 2 })
const C = RINGS_SIZE / 2

/** A bare event target standing in for the rings box (the unit tests run without a DOM). */
function fakeWrap(box = { left: 0, top: 0, width: RINGS_SIZE }) {
  const t = new EventTarget()
  const nodes = []
  return Object.assign(t, {
    children: nodes,
    classList: { toggle() {}, remove() {} },
    getBoundingClientRect: () => box,
    querySelector: (sel) => (sel === '.ctx-menu' ? nodes.find((n) => n.className === 'ctx-menu') ?? null : null),
    querySelectorAll: () => [],
    appendChild: (n) => { nodes.push(n); return n },
  })
}
/** An event with read-only fields (target is a getter on Event). */
const ev = (type, props) => Object.defineProperties(new Event(type, { cancelable: true }), Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value }])))
const target = (closest) => ({ closest: (sel) => (closest && sel.includes(closest) ? {} : null) })

describe('web_view: layout state', () => {
  it('keeps the geometry and the fit factor of the last draw, one pair at a time', () => {
    setRingsLayout(geo, 0.5)
    expect(ringsLayout().k).toBe(0.5)
    expect(ringsLayout().geo).toBe(geo)
  })
  it('exposes the constants the view and its tests share', () => {
    expect(RINGS_SIZE).toBe(352)
    expect(RING_LINE_HIT).toBe(10)
    expect(HIDDEN_GUIDE_OPACITY).toBe('.25')
  })
})

describe('web_view: localPoint', () => {
  it('reads a pointer in the rings own layout px, whatever scale the box is shown at', () => {
    expect(localPoint({ clientX: 110, clientY: 60 }, fakeWrap({ left: 10, top: 10, width: RINGS_SIZE }))).toEqual({ x: 100, y: 50 })
    expect(localPoint({ clientX: 110, clientY: 60 }, fakeWrap({ left: 10, top: 10, width: RINGS_SIZE / 2 }))).toEqual({ x: 200, y: 100 })
  })
})

describe('web_view: loadHiddenRings', () => {
  const store = {}
  beforeEach(() => { globalThis.window = { localStorage: { getItem: (k) => store[k] ?? null } } })
  afterEach(() => { delete globalThis.window })
  it('is the set stored by the toggles', () => {
    store[RINGS_HIDDEN_KEY] = JSON.stringify([Ring.Friend])
    expect([...loadHiddenRings()]).toEqual([Ring.Friend])
  })
  it('is empty when nothing is stored, the value is junk, or storage throws', () => {
    delete store[RINGS_HIDDEN_KEY]
    expect(loadHiddenRings().size).toBe(0)
    store[RINGS_HIDDEN_KEY] = '{nope'
    expect(loadHiddenRings().size).toBe(0)
    globalThis.window = { localStorage: { getItem: () => { throw new Error('blocked') } } }
    expect(loadHiddenRings().size).toBe(0)
  })
})

describe('web_view: reading a point against the rings', () => {
  it('ringNear: the nearest ring, and onLine only within RING_LINE_HIT of its circle', () => {
    setRingsLayout(geo, 1)
    const r = geo.radius[Ring.Friend]
    expect(ringNear(r)).toEqual({ ring: Ring.Friend, onLine: true })
    expect(ringNear(r + RING_LINE_HIT)).toMatchObject({ ring: Ring.Friend, onLine: true })
    expect(ringNear(r + RING_LINE_HIT + 1)).toEqual({ ring: Ring.Friend, onLine: false })
  })
  it('ringNear scales the radii by the fit factor', () => {
    setRingsLayout(geo, 0.5)
    expect(ringNear(geo.radius[Ring.Close] * 0.5)).toEqual({ ring: Ring.Close, onLine: true })
  })
  it('nearestRing: the picker ring closest to a distance (a tap), Acquaintance when nothing is nearer', () => {
    setRingsLayout(geo, 1)
    expect(nearestRing(geo.radius[Ring.Closest])).toBe(Ring.Closest)
    expect(nearestRing(geo.radius[Ring.Intending])).toBe(Ring.Intending)
    expect(nearestRing(0)).toBe(Ring.Closest)
  })
  it('dropTargetAt: ring, angle and hide-zone of a point in layout px', () => {
    setRingsLayout(geo, 1)
    const on = dropTargetAt(C + geo.radius[Ring.Friend], C)
    expect(on.ring).toBe(Ring.Friend)
    expect(on.out).toBe(false)
    expect(on.angle).toBeCloseTo(90, 6) // 0 = top, clockwise
    expect(dropTargetAt(C, C - geo.radius[Ring.Close]).angle).toBeCloseTo(0, 6)
    expect(dropTargetAt(C, C + 5000).out).toBe(true)
  })
})

describe('web_view: ringsMenuOn', () => {
  let doc
  beforeEach(() => {
    const made = []
    doc = { made, createElement: () => { const n = { children: [], style: {}, attrs: {}, listeners: {}, className: '', setAttribute(k, v) { this.attrs[k] = v }, addEventListener(e, f) { this.listeners[e] = f }, appendChild(c) { this.children.push(c); return c }, contains: () => false, remove() { this.removed = true } }; made.push(n); return n }, createTextNode: (t) => ({ text: t }), addEventListener() {} }
    globalThis.document = doc
  })
  afterEach(() => { delete globalThis.document })
  it('a right click on empty space opens the menu and cancels the browser menu; on a dot it does not', () => {
    setRingsLayout(geo, 1)
    const wrap = fakeWrap()
    ringsMenuOn(wrap, { spaceOut: () => {} }, () => {})
    let prevented = 0
    const click = (t) => { const e = ev('contextmenu', { target: t, clientX: C, clientY: C }); wrap.dispatchEvent(e); if (e.defaultPrevented) prevented++ }
    click(target('.node'))
    expect(wrap.children.length).toBe(0)
    click(target(null))
    expect(prevented).toBe(2) // both cancel the browser menu; only the empty space opens ours
    expect(wrap.children.length).toBe(1)
    expect(wrap.children[0].className).toBe('ctx-menu')
  })
  it('a press clears the held flag first (a mouse press starts no hold)', () => {
    const wrap = fakeWrap()
    const held = []
    ringsMenuOn(wrap, { spaceOut: () => {} }, (v) => held.push(v))
    wrap.dispatchEvent(ev('pointerdown', { isPrimary: true, pointerType: 'mouse', target: target(null), clientX: 1, clientY: 1 }))
    expect(held).toEqual([false])
  })
})

describe('web_view: dragOnRings', () => {
  it('ignores a press that is not on another person (the You node, empty space)', () => {
    const wrap = fakeWrap()
    const calls = []
    dragOnRings(wrap, { people: [{ id: 'p1' }] }, { render() { calls.push('render') } }, () => calls.push('dragged'))
    wrap.dispatchEvent(ev('pointerdown', { target: { closest: () => null }, clientX: 0, clientY: 0, pointerType: 'mouse' }))
    expect(calls).toEqual([])
  })
})

describe('web_view: dragOnRings, a drag with the mouse', () => {
  const person = () => ({ id: 'p1', name: 'Test Person', ring: Ring.Friend })
  const node = { dataset: { pid: 'p1' }, style: {}, classList: { add() {}, remove() {} } }
  beforeEach(() => { globalThis.window = Object.assign(new EventTarget(), { localStorage: { getItem: () => null } }) })
  afterEach(() => { delete globalThis.window })
  const press = (wrap) => wrap.dispatchEvent(ev('pointerdown', { target: { closest: () => node }, clientX: 10, clientY: 10, pointerType: 'mouse', isPrimary: true }))
  const at = (type, x, y) => window.dispatchEvent(ev(type, { clientX: x, clientY: y, isPrimary: true }))

  it('a drop on another ring keeps the angle it was dropped at and hands the move to the host', () => {
    setRingsLayout(geo, 1)
    const p = person(); const calls = []; const dragged = []
    const wrap = fakeWrap()
    dragOnRings(wrap, { people: [p] }, { render() {}, save() {}, dropOn: (...a) => calls.push(a) }, (v) => dragged.push(v))
    press(wrap)
    at('pointermove', C + geo.radius[Ring.Close], C)
    expect(dragged).toEqual([true])
    at('pointerup', C + geo.radius[Ring.Close], C)
    expect(calls).toEqual([[p, Ring.Close]])
    expect(p.angle).toBeCloseTo(90, 6)
  })
  it('a drop beyond the outermost ring hides the person through the host', () => {
    setRingsLayout(geo, 1)
    const p = person(); const hidden = []
    const wrap = fakeWrap()
    dragOnRings(wrap, { people: [p] }, { hideOnRings: (x) => { hidden.push(x); return Promise.resolve() } }, () => {})
    press(wrap)
    at('pointermove', C, C + 5000)
    at('pointerup', C, C + 5000)
    expect(hidden).toEqual([p])
  })
  it('a press that never moves 4 px lifts nothing: no drop, no render', () => {
    setRingsLayout(geo, 1)
    const p = person(); const calls = []
    const wrap = fakeWrap()
    dragOnRings(wrap, { people: [p] }, { render: () => calls.push('render'), dropOn: () => calls.push('drop') }, () => calls.push('dragged'))
    press(wrap)
    at('pointermove', 11, 11)
    at('pointerup', 11, 11)
    expect(calls).toEqual([])
  })
})
