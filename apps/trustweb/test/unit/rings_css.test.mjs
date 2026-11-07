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
})
