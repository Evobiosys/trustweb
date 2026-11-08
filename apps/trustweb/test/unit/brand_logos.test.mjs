// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 37 logos: every brand SVG of the logo family parses, has a viewBox, carries no script and no outside reference;
// the install icons have the sizes the manifest promises; the app header mark is the one-ring mark.
import fs from 'node:fs'
import path from 'node:path'
import { BRAND_MARK_SVG } from '../../src/brand_mark.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BRAND = path.join(ROOT, 'src/brand')
const SITES = ['one', 'com', 'org']
const FILES = SITES.flatMap((k) => [`mark_${k}.svg`, `mark_${k}_current.svg`, `favicon_${k}.svg`, `wordmark_${k}.svg`])

describe('brand SVGs of the logo family', () => {
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(BRAND, f), 'utf8')
    it(`${f} is one well-formed svg with a viewBox`, () => {
      expect(text.startsWith('<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->')).toBe(true)
      expect(text.match(/<svg\b/g)?.length).toBeGreaterThanOrEqual(1)
      expect(text.match(/<svg\b/g)?.length).toBe(text.match(/<\/svg>/g)?.length)
      expect(text).toMatch(/<svg[^>]*\sviewBox="[-\d. ]+"/)
      const open = (text.match(/<(path|circle|polygon|rect|g|text|tspan|style)\b/g) ?? []).length
      const close = (text.match(/<\/(g|text|tspan|style)>|\/>/g) ?? []).length
      expect(open).toBe(close)
    })
    it(`${f} has no script and no outside reference`, () => {
      expect(text).not.toMatch(/<script|\son[a-z]+=|javascript:/i)
      expect(text).not.toMatch(/(?:href|src)=|url\(\s*['"]?https?:|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i)
    })
  }
  it('the currentColor marks take their colour from the page, the fixed marks carry the family colour', () => {
    for (const k of SITES) {
      expect(fs.readFileSync(path.join(BRAND, `mark_${k}_current.svg`), 'utf8')).not.toMatch(/#[0-9A-F]{6}/i)
    }
    expect(fs.readFileSync(path.join(BRAND, 'mark_one.svg'), 'utf8')).toContain('#13867E')
    expect(fs.readFileSync(path.join(BRAND, 'mark_com.svg'), 'utf8')).toContain('#4A9BD1')
    expect(fs.readFileSync(path.join(BRAND, 'mark_org.svg'), 'utf8')).toContain('#33456B')
  })
  it('each wordmark spells its name and ends in its domain suffix', () => {
    const text = (k) => fs.readFileSync(path.join(BRAND, `wordmark_${k}.svg`), 'utf8')
    expect(text('one')).toMatch(/Trust<tspan[^>]*>Web<\/tspan>.*>\.one</s)
    expect(text('com')).toMatch(/Trust in the <tspan[^>]*>Web<\/tspan>.*>\.com</s)
    expect(text('org')).toMatch(/Trust in the <tspan[^>]*>Web<\/tspan>.*>\.org</s)
  })
  it('no wordmark loads an outside font', () => {
    for (const k of SITES) expect(fs.readFileSync(path.join(BRAND, `wordmark_${k}.svg`), 'utf8')).not.toMatch(/@font-face|fonts\.g/)
  })
})

describe('the app header mark', () => {
  it('is the one-ring mark in the text colour, hidden from assistive tech (the title beside it names the screen)', () => {
    expect(BRAND_MARK_SVG.startsWith('<svg')).toBe(true)
    expect(BRAND_MARK_SVG).toContain('currentColor')
    expect(BRAND_MARK_SVG).not.toContain('<!--')
    expect(BRAND_MARK_SVG).toContain('aria-hidden="true"')
    expect(BRAND_MARK_SVG).not.toContain('role="img"')
  })
})

function pngSize(file) {
  const b = fs.readFileSync(file)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('render_icons output sizes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pwa/manifest.json'), 'utf8'))
  it('every manifest icon exists at the size it names', () => {
    for (const i of manifest.icons) {
      const n = Number(i.sizes.split('x')[0])
      expect(pngSize(path.join(ROOT, 'pwa', i.src))).toEqual([n, n])
    }
  })
  it('the Apple touch icon is 180 px', () => {
    expect(pngSize(path.join(ROOT, 'pwa/icons/apple-touch-icon.png'))).toEqual([180, 180])
  })
  it('the renderer reads the one-ring mark of the family', () => {
    expect(fs.readFileSync(path.join(ROOT, 'pwa/render_icons.mjs'), 'utf8')).toContain('mark_one.svg')
  })
  it('the manifest colours follow the family (teal theme, #FAFAF7 background)', () => {
    expect(manifest.theme_color).toBe('#13867E')
    expect(manifest.background_color).toBe('#FAFAF7')
  })
})
