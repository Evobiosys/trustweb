// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Step card: drag clamp, remembered position, and the panel collapse that a "?" press causes. */
import { clampCard, stepCardPosStore, stepFold } from '../../src/dev_preview_rules.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } } }

describe('step card drag', () => {
  it('clamps the card inside the viewport', () => {
    expect(clampCard(-20, -5, 300, 80, 1000, 700)).toEqual({ left: 0, top: 0 })
    expect(clampCard(900, 690, 300, 80, 1000, 700)).toEqual({ left: 700, top: 620 })
    expect(clampCard(50, 60, 300, 80, 1000, 700)).toEqual({ left: 50, top: 60 })
  })
  it('remembers the position, and a reset forgets it', () => {
    const s = stepCardPosStore(mem())
    expect(s.get()).toBeNull()
    s.set({ left: 10, top: 20 })
    expect(s.get()).toEqual({ left: 10, top: 20 })
    s.clear()
    expect(s.get()).toBeNull()
  })
  it('ignores junk in storage and unavailable storage', () => {
    const m = mem(); m.setItem('twp-step-pos', '{"left":"x"}')
    expect(stepCardPosStore(m).get()).toBeNull()
    const broken = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    expect(stepCardPosStore(broken).get()).toBeNull()
    expect(() => { stepCardPosStore(broken).set({ left: 1, top: 2 }) }).not.toThrow()
  })
})

describe('step fold', () => {
  it('a "?" press collapses an expanded panel and the end of the walk expands it again', () => {
    const f = stepFold()
    expect(f.press(false)).toBe(true)
    expect(f.end()).toBe(true)
    expect(f.end()).toBe(false)
  })
  it('a panel the owner collapsed stays collapsed', () => {
    const f = stepFold()
    expect(f.press(true)).toBe(false)
    expect(f.end()).toBe(false)
  })
  it('the owner expanding it meanwhile cancels the restore', () => {
    const f = stepFold()
    f.press(false); f.owner()
    expect(f.end()).toBe(false)
  })
})
