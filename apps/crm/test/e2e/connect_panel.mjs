// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A12: the Curator's person page (long press / right click on a person of the web) shows the Connect panel and saves a Signal link. Needs a dev server with a person who is not connected:  PORT=5461 SHOT=/tmp/cc node test/e2e/connect_panel.mjs */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const url = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const shot = process.env.SHOT ?? path.join(tmpdir(), 'cc')
let failed = false
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
for (const [tag, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1440, height: 900 }, false]]) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'cc-')), { headless: true, executablePath: process.env.CHROMIUM_PATH, viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, args: ['--use-mock-keychain', '--password-store=basic'] })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  await page.waitForSelector('.node[data-pid]', { timeout: 20_000 })
  const cur = page.locator('[data-screen=person]')
  const connect = cur.locator('[data-part=connect]')
  for (let i = 0; i < 12; i++) {   // the first person that is not connected yet has the Connect line
    await page.locator('.node[data-pid]').nth(i).dispatchEvent('contextmenu')   // the long-press twin: the person's own page
    await connect.waitFor({ state: 'attached', timeout: 15_000 })
    if (await connect.locator('[data-action=connect]').count()) break
    await page.goto(url)
    await page.waitForSelector('.node[data-pid]', { timeout: 20_000 })
  }
  await connect.locator('[data-action=connect]').click()
  ok(`${tag}: panel with link`, await connect.locator('[data-connect-link]').isVisible())
  await connect.locator('[data-add-link=signal]').click()
  await connect.locator('[data-link-input=signal]').fill('https://signal.me/#p/test')
  await connect.locator('[data-link-save=signal]').click()
  ok(`${tag}: signal link shown`, (await connect.locator('[data-card-link=signal] a').getAttribute('href')) === 'https://signal.me/#p/test')
  const saved = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith('trustweb.v1')).map(([, v]) => v)).includes('signal.me/#p/test'))
  ok(`${tag}: link reached the host record`, saved)
  await page.screenshot({ path: `${shot}-${tag}.png` })
  ok(`${tag}: no page errors`, errors.length === 0)
  await ctx.close()
}
process.exit(failed ? 1 : 0)
