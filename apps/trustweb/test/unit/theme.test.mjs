// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { readTheme, applyTheme, THEME_KEY } from '../../src/theme.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m } }
const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const inline = readFileSync(new URL('../../src/design/boot_theme.inline.js', import.meta.url), 'utf8').trim()

// Runs the inline boot block in a stub browser; returns the data-theme it set.
const boot = (localStorage) => {
  const documentElement = { dataset: {} }
  vm.runInNewContext(inline, { document: { documentElement }, window: {}, navigator: {}, get localStorage() { if (localStorage === 'throws') throw new Error('denied'); return localStorage } })
  return documentElement.dataset.theme
}

describe('theme', () => {
  it('defaults to system when nothing is stored', () => expect(readTheme(mem())).toBe('system'))
  it('defaults to system without a storage', () => expect(readTheme(null)).toBe('system'))
  it('reads a stored value', () => { const s = mem(); s.setItem(THEME_KEY, 'dark'); expect(readTheme(s)).toBe('dark') })
  it('falls back to system on garbage', () => { const s = mem(); s.setItem(THEME_KEY, 'blue'); expect(readTheme(s)).toBe('system') })
  it('survives a throwing storage', () => expect(readTheme(throwing)).toBe('system'))
  it('applies and persists', () => {
    const root = { dataset: {}, setAttribute(k, v) { this.dataset[k] = v } }
    const s = mem(); applyTheme('light', root, s)
    expect(root.dataset['data-theme']).toBe('light'); expect(s.getItem(THEME_KEY)).toBe('light')
  })
  it('applies without throwing when storage throws', () => {
    const root = { setAttribute() {} }; expect(() => applyTheme('dark', root, throwing)).not.toThrow()
  })
  it('index.html carries the inline boot block verbatim', () => {
    const m = html.match(/<!-- boot:theme -->\s*<script>([\s\S]*?)<\/script>\s*<!-- \/boot:theme -->/)
    expect(m, 'boot block present').toBeTruthy(); expect(m[1].trim()).toBe(inline)
  })
  it('boot block comes before the favicon link', () => expect(html.indexOf('<!-- boot:theme -->')).toBeLessThan(html.indexOf('<link rel="icon"')))
})

describe('boot_theme.inline.js', () => {
  it('sets a stored theme', () => { const s = mem(); s.setItem(THEME_KEY, 'light'); expect(boot(s)).toBe('light') })
  it('sets system when nothing is stored', () => expect(boot(mem())).toBe('system'))
  it('sets system on a garbage value', () => { const s = mem(); s.setItem(THEME_KEY, 'blue'); expect(boot(s)).toBe('system') })
  it('sets system and does not throw when localStorage throws', () => expect(boot('throws')).toBe('system'))
  it('sets system when getItem throws', () => expect(boot(throwing)).toBe('system'))
})

describe('styles.css head', () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  it('imports the generated tokens first', () => expect(css.replace(/\/\*[\s\S]*?\*\//g, '').trimStart().startsWith("@import './design/tokens.css';")).toBe(true))
  it('no longer carries the old dark default block', () => expect(css).not.toContain(':root:not([data-theme="light"]){'))
})
