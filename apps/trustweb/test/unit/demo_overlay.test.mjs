/** Demo-content overlay: the X is remembered per device until the record (me.id) changes (src/demo_overlay.ts, wave 45). */
import { DEMO_OVERLAY_KEY, demoOverlayDismissed, dismissDemoOverlay } from '../../src/demo_overlay.ts'

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), m } }
const rec = (id) => ({ me: { id, displayName: 'J' } })

describe('demo overlay dismissal', () => {
  it('is not dismissed before the X', () => {
    expect(demoOverlayDismissed(store(), rec('a'))).toBe(false)
  })
  it('the X is remembered for the same record', () => {
    const s = store()
    dismissDemoOverlay(s, rec('a'))
    expect(s.m.get(DEMO_OVERLAY_KEY)).toBe('a')
    expect(demoOverlayDismissed(s, rec('a'))).toBe(true)
  })
  it('a changed record shows the chip again', () => {
    const s = store()
    dismissDemoOverlay(s, rec('a'))
    expect(demoOverlayDismissed(s, rec('b'))).toBe(false)
  })
  it('blocked storage neither throws nor dismisses', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => dismissDemoOverlay(bad, rec('a'))).not.toThrow()
    expect(demoOverlayDismissed(bad, rec('a'))).toBe(false)
  })
})
