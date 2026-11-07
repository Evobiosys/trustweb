// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { renderTokensCss } from '../../scripts/build_tokens.mjs'
const tokens = JSON.parse(readFileSync(new URL('../../src/design/tokens.json', import.meta.url), 'utf8'))
const css = readFileSync(new URL('../../src/design/tokens.css', import.meta.url), 'utf8')

describe('design tokens', () => {
  it('tokens.css is generated from tokens.json and up to date', () => {
    expect(css).toBe(renderTokensCss(tokens))
  })
  it('light and dark define the same names', () => {
    expect(Object.keys(tokens.one.dark).sort()).toEqual(Object.keys(tokens.one.light).sort())
  })
  it('carries every name the spec fixes', () => {
    const must = ['surface-0','surface-1','surface-2','raised','ink','ink-2','ink-3','line','line-strong',
      'trust','trust-strong','trust-tint','on-trust','shared','shared-tint','shared-ink',
      'attention','attention-tint','attention-ink','intending','intending-tint','intending-ink',
      'looking-tint','looking-ink','resource-tint','resource-ink','focus','person-default','shadow-float']
    for (const n of must) expect(tokens.one.light, n).toHaveProperty(n)
    const core = ['font-sans','font-serif','font-mono','fs-1','fs-2','fs-3','fs-4','fs-5','fs-6','fs-7',
      'lh-tight','lh-ui','lh-text','s-1','s-2','s-3','s-4','s-5','s-6','s-7','s-8',
      'r-people','r-card','r-control','r-chip','r-sheet','dur-1','dur-2','ease']
    for (const n of core) expect(tokens.core, n).toHaveProperty(n)
  })
  it('every alias points at a defined token', () => {
    const defined = new Set([...Object.keys(tokens.core), ...Object.keys(tokens.one.light)])
    for (const [old, target] of Object.entries(tokens.aliases)) expect(defined.has(target), `${old} -> ${target}`).toBe(true)
  })
  it('emits the four blocks in order', () => {
    const i = (s) => css.indexOf(s)
    expect(i(':root{')).toBeGreaterThanOrEqual(0)
    expect(i(':root[data-theme="dark"]{')).toBeGreaterThan(i(':root{'))
    expect(i('@media (prefers-color-scheme:dark){')).toBeGreaterThan(i(':root[data-theme="dark"]{'))
    expect(css.lastIndexOf(':root{')).toBeGreaterThan(i('@media (prefers-color-scheme:dark){'))
    expect(css).toContain('--violet:var(--trust)')
  })
})
