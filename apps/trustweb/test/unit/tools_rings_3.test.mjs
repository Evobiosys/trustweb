// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b tools-rings-3: a dragged dot stays, m resets every ring, the closest row is moot when it adds nothing. */
import { closestMoot, keepPinned, limitOf, pickFive, setPerRingLimit } from '../../src/membranes_five.ts'

const NOW = Date.UTC(2026, 10, 7)
const person = (id, o = {}) => ({ id, name: id, ring: 'acquaintance', metAt: 0, fields: [], ...o })
const crowd = Array.from({ length: 300 }, (_, i) => person('p' + String(i).padStart(3, '0'), { metAt: i % 7 }))
const ids = (ps) => ps.map((p) => p.id)

describe('keepPinned: the dragged dot is drawn in addition to the cut', () => {
  it('a dot outside the cut joins shown, leaves rest', () => {
    const cut = pickFive(crowd, { people: crowd }, 5, NOW)
    const out = cut.rest[40].id
    const r = keepPinned(cut, out)
    expect(r.shown.length).toBe(6)
    expect(ids(r.shown)).toContain(out)
    expect(ids(r.rest)).not.toContain(out)
    expect(ids(r.shown.slice(0, 5))).toEqual(ids(cut.shown))
  })
  it('a dot already shown, an unknown id or none changes nothing', () => {
    const cut = pickFive(crowd, { people: crowd }, 5, NOW)
    expect(keepPinned(cut, cut.shown[0].id)).toBe(cut)
    expect(keepPinned(cut, 'nobody')).toBe(cut)
    expect(keepPinned(cut, undefined)).toBe(cut)
  })
})

describe('setPerRingLimit: m resets every ring and dials back to the same people', () => {
  const s = { membraneLimit: 6, uiRings: { filled: ['friend'], rankBy: 'recent' } }
  it('clears filled, keeps other view settings; 5 is the default (field removed)', () => {
    setPerRingLimit(s, 4)
    expect(s.membraneLimit).toBe(4)
    expect(s.uiRings.filled).toBeUndefined()
    expect(s.uiRings.rankBy).toBe('recent')
    setPerRingLimit(s, 5)
    expect('membraneLimit' in s).toBe(false)
  })
  it('300 people: m=6 set A; m=4 inside A; m=6 again equals A', () => {
    const cut = (m) => ids(pickFive(crowd, { people: crowd }, m, NOW).shown)
    const a = cut(6)
    expect(cut(4)).toEqual(a.slice(0, 4))
    expect(cut(6)).toEqual(a)
    expect(limitOf({ membraneLimit: 6 })).toBe(6)
  })
})

describe('closestMoot', () => {
  it('5 per ring over 7 rings = 35 <= 150 -> moot', () => expect(closestMoot(5, 7, 150)).toBe(true))
  it('exactly n is still moot, one more is not', () => {
    expect(closestMoot(30, 5, 150)).toBe(true)
    expect(closestMoot(31, 5, 150)).toBe(false)
  })
})

describe('preview panel: the minimize button stays above select all', () => {
  it('the header (holding –) is sticky at the top of the scrolling panel', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(new URL('../../src/dev_preview.ts', import.meta.url), 'utf8')).toMatch(/\.twp header\{[^}]*position:sticky;top:0/)
  })
})
