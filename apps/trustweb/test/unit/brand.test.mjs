// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync, existsSync } from 'node:fs'
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
describe('brand', () => {
  it('holarchic ring geometry', () => {
    const svg = read('../../src/brand/holarchic_ring.svg')
    expect(svg).toContain('viewBox="0 0 40 40"')
    expect(svg).toMatch(/r="5\.5"/); expect(svg).toMatch(/A11\.5 11\.5/); expect(svg).toMatch(/A17 17/); expect(svg).toMatch(/r="2\.3"/)
    expect(svg).toContain('currentColor'); expect(svg).toContain('var(--ink, #1F2A28)')
  })
  for (const [f, hex] of [['wordmark_one.svg', '#13867E'], ['wordmark_com.svg', '#4A9BD1'], ['wordmark_org.svg', '#33456B']])
    it(`${f} carries its site colour`, () => {
      const svg = read('../../src/brand/' + f)
      expect(svg).toContain(hex); expect(svg).toContain('font-weight="300"'); expect(svg).toMatch(/>Web</)
    })
  it('favicon is the mark, not the purple disc', () => {
    const html = read('../../index.html')
    expect(html).not.toContain('%239A37F0'); expect(html).toMatch(/rel="icon" href="data:image\/svg\+xml,[^"]*r=%2215%22/)
  })
  it('render_icons draws the mark, not the purple disc', () => {
    const js = read('../../pwa/render_icons.mjs')
    expect(js).not.toContain('9A37F0'); expect(js).toContain('mark_one.svg')
  })
  it('voice text exists and defers to the UX log', () => {
    expect(existsSync(new URL('../../../../docs/design/voice.txt', import.meta.url))).toBe(true)
    expect(read('../../../../docs/design/voice.txt')).toContain('docs/10-ux-decisions.md')
  })
})
