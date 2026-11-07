/**
 * Renders the install icons (wave 1733, item 5) from the app's brand mark: the
 * holarchic ring of the favicon in index.html (src/brand/holarchic_ring.svg),
 * in the .one teal. Headless Chromium from the local Playwright cache, no installed tools:
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node ../trustweb/pwa/render_icons.mjs
 *
 * "any" icons: the mark on transparent, as the favicon. "maskable" and the
 * Apple touch icon: full bleed on linen (the platform crops to its own shape),
 * the mark kept inside the 80 % safe zone.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEAL = '#13867E'
const LINEN = '#F5F0E8'
// Geometry of src/brand/holarchic_ring.svg (viewBox 0 0 40 40); every part in the site colour.
const ring = `<circle cx="20" cy="20" r="5.5" stroke-width="3"/><path d="M20 8.5 A11.5 11.5 0 1 1 8.5 20" stroke-width="1.7" stroke-linecap="round"/><path d="M37 20 A17 17 0 1 1 20 3" stroke-width="1.7" stroke-linecap="round"/><circle cx="20" cy="3" r="2.3" fill="${TEAL}" stroke="none"/>`
const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 42 42" fill="none" stroke="${TEAL}">${ring}</svg>`
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${LINEN}"/><g transform="translate(20 20) scale(1.5)" fill="none" stroke="${TEAL}">${ring}</g></svg>`
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
    await page.setContent(`<html><body style="margin:0;background:transparent">${o.svg.replace('<svg ', `<svg width="${o.size}" height="${o.size}" `)}</body></html>`)
    await page.screenshot({ path: path.join(HERE, o.file), omitBackground: true, clip: { x: 0, y: 0, width: o.size, height: o.size } })
    await page.close()
    console.log('wrote', o.file)
  }
} finally {
  await browser.close()
}
