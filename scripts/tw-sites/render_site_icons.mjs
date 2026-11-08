// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Renders the install icons of the three sites into scripts/tw-sites/assets/<site>/ from the logo family's marks
 * (apps/trustweb/src/brand/mark_<site>.svg, wave 37). Run once after a colour change; the PNGs are committed.
 *
 *   PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node scripts/tw-sites/render_site_icons.mjs
 *
 * "any" icons: the mark on transparent. "maskable" and the Apple touch icon: full bleed on the site's linen, mark inside the safe zone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRAND = path.join(HERE, '../../apps/trustweb/src/brand')
const SITES = { one: '#F5F0E8', com: '#F5F0E8', org: '#F5F0E8' }
const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core')
const chromium = (pw.chromium ? pw : pw.default).chromium
const browser = await chromium.launch({ headless: true })
try {
  for (const [key, linen] of Object.entries(SITES)) {
    const mark = fs.readFileSync(path.join(BRAND, `mark_${key}.svg`), 'utf8').replace(/<!--.*?-->\s*/s, '')
    const at = (attrs) => mark.replace('<svg ', `<svg ${attrs} `)
    const disc = at('width="100%" height="100%"')
    const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${linen}"/>${at('x="10" y="10" width="80" height="80"').replace(' xmlns="http://www.w3.org/2000/svg"', '')}</svg>`
    const out = [['icon-192.png', 192, disc], ['icon-512.png', 512, disc], ['icon-maskable-512.png', 512, bleed], ['apple-touch-icon.png', 180, bleed]]
    fs.mkdirSync(path.join(HERE, 'assets', key), { recursive: true })
    for (const [file, size, svg] of out) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`)
      await page.screenshot({ path: path.join(HERE, 'assets', key, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
      await page.close()
      console.log('wrote', key, file)
    }
  }
} finally {
  await browser.close()
}
