// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 demo-content-overlay (headless, dev only): PORT=5466 SHOTS=<dir> EXE=<chromium> node demo_overlay.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5466}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = (id) => JSON.stringify({ v: 1, me: { id, displayName: 'Test' }, people: [], peers: [], log: [], inventory: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record('rec1'))
  await page.reload(); await page.waitForTimeout(1500)
  const ov = page.locator('[data-demo-overlay]')
  check('overlay visible with the chip', await ov.isVisible() && (await ov.locator('.demo-toggle').innerText()) === 'Show demo content')
  const o = await ov.boundingBox(), x = await page.locator('[data-demo-overlay-x]').boundingBox(), c = await ov.locator('.demo-toggle').boundingBox()
  check('X sits above the chip', x.y + x.height <= c.y + 1)
  check('floating: fixed, bottom bar takes no padding', (await ov.evaluate((e) => getComputedStyle(e).position)) === 'fixed'
    && (await page.locator('.tabs').evaluate((e) => getComputedStyle(e).paddingLeft)) === '8px')
  await page.screenshot({ path: `${SHOTS}/demo-overlay-1280.png` })
  await page.locator('[data-demo-overlay-x]').click(); await page.waitForTimeout(200)
  check('X hides the overlay', await ov.isHidden())
  await page.reload(); await page.waitForTimeout(1500)
  check('stays dismissed after reload (same record)', await ov.isHidden())
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record('rec2'))
  await page.reload(); await page.waitForTimeout(1500)
  check('a changed record shows it again', await ov.isVisible())
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(300)
  check('phone width: overlay not shown, no document scroll', await ov.isHidden() && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
  await page.screenshot({ path: `${SHOTS}/demo-overlay-360.png` })
  check('no page errors', errors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
