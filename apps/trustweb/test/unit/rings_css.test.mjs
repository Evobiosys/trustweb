// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../../src/components/rings.css')
const tokens = JSON.parse(read('../../src/design/tokens.json'))
describe('rings.css', () => {
  for (const sel of ['.rings-wrap', '.node', '.ava', '.node.you .ava', '.node.shared .ava', '.node.asked .ava', '.node.nonresp', '.node.quiet', '.node.intending .ava', '.node.live .ava::after', '.trust-path'])
    it(`defines ${sel}`, () => expect(css).toContain(sel))
  it('uses no raw colour', () => expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/))
  it('presence pulse uses the ease token and 1.8s', () => expect(css).toMatch(/animation:\s*presence 1\.8s var\(--ease\)/))
  it('asked pulse runs on the motion tokens', () => expect(css).toMatch(/animation:\s*asked var\(--dur-2\)/))
  it('trust path: 2.5 px trust stroke, dash 6 7, round caps', () => {
    const rule = css.match(/\.trust-path\s*\{[^}]*\}/)[0]
    for (const part of ['var(--trust)', '2.5', '6 7', 'round', 'opacity:.9']) expect(rule).toContain(part)
  })
  it('styles.css imports it after tokens and no longer holds the node rules', () => {
    const s = read('../../src/styles.css')
    expect(s.indexOf("@import './components/rings.css'")).toBeGreaterThan(s.indexOf("@import './design/tokens.css'"))
    expect(s).not.toContain('.node.you .ava')
    expect(s).not.toContain('.node.asked .ava{animation')
  })
  it('the tokens it reads exist in light and dark', () => {
    for (const n of ['on-person', 'ring-ink']) {
      expect(tokens.one.light, n).toHaveProperty(n)
      expect(tokens.one.dark, n).toHaveProperty(n)
    }
  })
  // wave 42 web-zoom-dots
  it('wave 42: the label size has ONE rule (styles.css, var(--lbl)); rings.css no longer carries the --rz twin', () => {
    expect(css).not.toContain('--rz')
    expect(read('../../src/styles.css')).toContain('.rings-zoom .rings-wrap .node:not(.you) span{font-size:var(--lbl')
  })
  it('wave 42: the zoomable Web body blocks browser pinch (touch-action pan-x pan-y), so the web zooms, not the page', () => {
    expect(read('../../src/styles.css')).toMatch(/\.scroll\.zoomable\{[^}]*touch-action:\s*pan-x pan-y/)
  })
  it('wave 42: ring card titles wrap at word boundaries only', () => {
    const rule = read('../../src/styles.css').match(/\.ring-card\{[^}]*\}/)[0]
    expect(rule).toContain('overflow-wrap:normal')
    expect(rule).toContain('hyphens:manual')
    expect(rule).not.toContain('anywhere')
  })
})
