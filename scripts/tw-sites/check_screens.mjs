// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Headless check of the three built sites: no horizontal scroll at 360 and 1280 px on any page,
 * screenshots of every front page (light at both widths, dark at 360).
 *
 *   PLAYWRIGHT_PACKAGE=<playwright-core/index.js> node scripts/tw-sites/check_screens.mjs <out dir> <screens dir>
 *
 * Exit 0 ok, 1 overflow found, 3 playwright or chromium missing. Uses the local browser cache, no download.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [outDir, shotsDir] = process.argv.slice(2)
const SITES = { org: 'trustintheweb-org', com: 'trustintheweb-com', one: 'trustweb-one' }
let chromium
try {
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core')
  chromium = (pw.chromium ? pw : pw.default).chromium
} catch (e) {
  console.error('playwright-core not found:', e.message)
  process.exit(3)
}
let browser
try {
  browser = await chromium.launch({ headless: true })
} catch (e) {
  console.error('chromium not launchable:', e.message.split('\n')[0])
  process.exit(3)
}
fs.mkdirSync(shotsDir, { recursive: true })
const bad = []
try {
  for (const [key, dir] of Object.entries(SITES)) {
    const pages = fs.readdirSync(path.join(outDir, dir)).filter((f) => f.endsWith('.html')).sort()
    for (const [width, scheme] of [[360, 'light'], [1280, 'light'], [360, 'dark']]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme })
      const page = await ctx.newPage()
      for (const name of pages) {
        await page.goto(pathToFileURL(path.join(outDir, dir, name)).href)
        const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
        if (scroll > inner) bad.push(`${key}/${name} @${width} ${scheme}: scrollWidth ${scroll} > ${inner}`)
        if (name === 'index.html') {
          const file = `${process.env.SHOT_PREFIX || 'sites-three'}-${key}-${width}${scheme === 'dark' ? '-dark' : ''}.png`
          await page.screenshot({ path: path.join(shotsDir, file), fullPage: true })
        }
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
if (bad.length) {
  console.log(bad.join('\n'))
  process.exit(1)
}
console.log('no horizontal scroll on', Object.keys(SITES).length, 'sites at 360 and 1280')
