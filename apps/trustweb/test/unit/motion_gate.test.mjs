// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { motionAllowed, installMotionGate } from '../../src/motion_gate.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('motionAllowed', () => {
  it('on by default', () => expect(motionAllowed({ reducedMotion: false })).toBe(true))
  it('off under reduced motion', () => expect(motionAllowed({ reducedMotion: true })).toBe(false))
  it('off under save-data', () => expect(motionAllowed({ reducedMotion: false, saveData: true })).toBe(false))
  for (const t of ['slow-2g', '2g', '3g']) it(`off on ${t}`, () => expect(motionAllowed({ reducedMotion: false, effectiveType: t })).toBe(false))
  it('on for 4g and for unknown networks', () => {
    expect(motionAllowed({ reducedMotion: false, effectiveType: '4g' })).toBe(true)
    expect(motionAllowed({ reducedMotion: false, effectiveType: undefined })).toBe(true)
  })
  it('the inline boot block agrees with the module', () => {
    const src = read('../../src/design/boot_theme.inline.js')
    const run = (conn, reduced) => {
      const root = { dataset: {} }
      const ctx = { document: { documentElement: root }, localStorage: { getItem: () => null },
        navigator: { connection: conn }, matchMedia: () => ({ matches: reduced }) }
      vm.runInNewContext(src, ctx); return root.dataset.motion
    }
    expect(run(undefined, false)).toBe('on')
    expect(run({ effectiveType: '3g' }, false)).toBe('off')
    expect(run({ saveData: true }, false)).toBe('off')
    expect(run(undefined, true)).toBe('off')
    expect(run({ effectiveType: '4g' }, false)).toBe('on')
  })
  it('the inline boot block survives a browser without matchMedia and still sets the theme', () => {
    const root = { dataset: {} }
    vm.runInNewContext(read('../../src/design/boot_theme.inline.js'), { document: { documentElement: root }, localStorage: { getItem: () => null }, navigator: {} })
    expect(root.dataset.theme).toBe('system'); expect(root.dataset.motion).toBe('on')
  })
})

// A stub window: records listeners so a test can fire them.
const stubWin = ({ reduced = false, conn } = {}) => {
  const mqListeners = []; const connListeners = []
  const mq = { matches: reduced, addEventListener: (_, f) => mqListeners.push(f) }
  const root = { dataset: {} }
  const win = { document: { documentElement: root }, matchMedia: () => mq,
    navigator: conn === undefined ? {} : { connection: Object.assign(conn, { addEventListener: (_, f) => connListeners.push(f) }) } }
  return { win, root, mq, fireMq: () => mqListeners.forEach((f) => f()), fireConn: () => connListeners.forEach((f) => f()), conn }
}

describe('installMotionGate', () => {
  it('sets data-motion on now', () => { const s = stubWin(); installMotionGate(s.win); expect(s.root.dataset.motion).toBe('on') })
  it('off under reduced motion', () => { const s = stubWin({ reduced: true }); installMotionGate(s.win); expect(s.root.dataset.motion).toBe('off') })
  it('re-evaluates when the reduced-motion query changes', () => {
    const s = stubWin(); installMotionGate(s.win); s.mq.matches = true; s.fireMq(); expect(s.root.dataset.motion).toBe('off')
  })
  it('re-evaluates when the connection changes', () => {
    const s = stubWin({ conn: { effectiveType: '4g' } }); installMotionGate(s.win)
    expect(s.root.dataset.motion).toBe('on'); s.conn.effectiveType = '2g'; s.fireConn(); expect(s.root.dataset.motion).toBe('off')
  })
  it('leaves motion on without navigator.connection', () => {
    const s = stubWin(); expect(() => installMotionGate(s.win)).not.toThrow(); expect(s.root.dataset.motion).toBe('on')
  })
})

describe('motion rules in tokens.css', () => {
  const css = read('../../src/design/tokens.css')
  it('zero the durations under reduced motion and data-motion=off, and stop animations', () => {
    expect(css).toContain('@media (prefers-reduced-motion:reduce){:root{--dur-1:0ms;--dur-2:0ms}}')
    expect(css).toContain(':root[data-motion="off"]{--dur-1:0ms;--dur-2:0ms}')
    expect(css).toContain(':root[data-motion="off"] *{animation:none !important}')
  })
})
