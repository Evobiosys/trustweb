/**
 * Renders the install icons from the app's brand mark, the one-ring mark of the logo family
 * (src/brand/mark_one.svg, wave 37), in the .one teal. Headless Chromium from the local Playwright cache, no installed tools:
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node ../trustweb/pwa/render_icons.mjs
 *
 * "any" icons: the mark on transparent, as the favicon. "maskable" and the Apple touch icon: full bleed on linen
 * (the platform crops to its own shape), the mark kept inside the 80 % safe zone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LINEN = '#F5F0E8'
const mark = fs.readFileSync(path.join(HERE, '../src/brand/mark_one.svg'), 'utf8').replace(/<!--.*?-->\s*/s, '')
const at = (attrs) => mark.replace('<svg ', `<svg ${attrs} `)
const disc = at('width="100%" height="100%"')
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${LINEN}"/>${at('x="10" y="10" width="80" height="80"').replace(' xmlns="http://www.w3.org/2000/svg"', '')}</svg>`
const OUT = [
  { file: 'icons/icon-192.png', size: 192, svg: disc },
  { file: 'icons/icon-512.png', size: 512, svg: disc },
  { file: 'icons/icon-maskable-512.png', size: 512, svg: bleed },
  { file: 'icons/apple-touch-icon.png', size: 180, svg: bleed },
]

const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
const chromium = (pw.chromium ? pw : pw.default).chromium
const browser = await chromium.launch({ headless: true })
try {
  for (const o of OUT) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size }, deviceScaleFactor: 1 })
    await page.setContent(`<html><body style="margin:0;background:transparent">${o.svg.replace('<svg ', `<svg style="display:block;width:${o.size}px;height:${o.size}px" `)}</body></html>`)
    await page.screenshot({ path: path.join(HERE, o.file), omitBackground: true, clip: { x: 0, y: 0, width: o.size, height: o.size } })
    await page.close()
    console.log('wrote', o.file)
  }
} finally {
  await browser.close()
}
