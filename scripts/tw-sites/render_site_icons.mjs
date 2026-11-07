// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Renders the install icons of the three sites into scripts/tw-sites/assets/<site>/ from the holarchic ring
 * (apps/trustweb/src/brand/holarchic_ring.svg) in each site colour. Run once after a colour change; the PNGs are committed.
 *
 *   PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node scripts/tw-sites/render_site_icons.mjs
 *
 * "any" icons: the mark on transparent. "maskable" and the Apple touch icon: full bleed on the site's linen, mark inside the safe zone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITES = { one: ['#13847C', '#F5F0E8'], com: ['#4A9BD1', '#F5F0E8'], org: ['#33456B', '#F5F0E8'] }
const ring = (c) => `<circle cx="20" cy="20" r="5.5" stroke-width="3"/><path d="M20 8.5 A11.5 11.5 0 1 1 8.5 20" stroke-width="1.7" stroke-linecap="round"/><path d="M37 20 A17 17 0 1 1 20 3" stroke-width="1.7" stroke-linecap="round"/><circle cx="20" cy="3" r="2.3" fill="${c}" stroke="none"/>`
const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core')
const chromium = (pw.chromium ? pw : pw.default).chromium
const browser = await chromium.launch({ headless: true })
try {
  for (const [key, [mark, linen]] of Object.entries(SITES)) {
    const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 42 42" fill="none" stroke="${mark}">${ring(mark)}</svg>`
    const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${linen}"/><g transform="translate(20 20) scale(1.5)" fill="none" stroke="${mark}">${ring(mark)}</g></svg>`
    const out = [['icon-192.png', 192, disc], ['icon-512.png', 512, disc], ['icon-maskable-512.png', 512, bleed], ['apple-touch-icon.png', 180, bleed]]
    fs.mkdirSync(path.join(HERE, 'assets', key), { recursive: true })
    for (const [file, size, svg] of out) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
      await page.screenshot({ path: path.join(HERE, 'assets', key, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
      await page.close()
      console.log('wrote', key, file)
    }
  }
} finally {
  await browser.close()
}
