import { describe, expect, it } from 'vitest'
import { TABBAR_MODES, TabbarMode, tabbarMode } from '../../src/tabbar'

describe('tabbarMode', () => {
  it('falls back to always for a missing or unknown value', () => {
    for (const x of [undefined, null, 'sideways', 3, {}]) expect(tabbarMode(x)).toBe(TabbarMode.Always)
  })
  it('round-trips each mode', () => {
    for (const m of TABBAR_MODES) expect(tabbarMode(JSON.parse(JSON.stringify(m)))).toBe(m)
    expect(TABBAR_MODES).toEqual(['always', 'hover', 'hidden'])
  })
})
