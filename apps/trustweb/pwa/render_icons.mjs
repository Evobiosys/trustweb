/**
 * Renders the install icons (wave 1733, item 5) from the app's existing
 * artwork: the favicon in index.html (a violet disc with a dashed white ring).
 * Headless Chromium from the local Playwright cache, no installed tools:
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node ../trustweb/pwa/render_icons.mjs
 *
 * "any" icons: the disc on transparent, as the favicon. "maskable" and the
 * Apple touch icon: full bleed (the platform crops to its own shape), the ring
 * kept inside the 80 % safe zone.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VIOLET = '#9A37F0'
// The favicon's own geometry (viewBox 0 0 100 100): disc r=44, ring r=26, stroke 6, dash 8 8.
const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${VIOLET}"/><circle cx="50" cy="50" r="26" fill="none" stroke="white" stroke-width="6" stroke-dasharray="8 8"/></svg>`
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${VIOLET}"/><circle cx="50" cy="50" r="22" fill="none" stroke="white" stroke-width="5" stroke-dasharray="6.8 6.8"/></svg>`
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
