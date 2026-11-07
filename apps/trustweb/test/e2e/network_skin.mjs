// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 network-skin proof (headless): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node network_skin.mjs. Synthetic record. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 86_400_000, fields: {}, ...o })
  const people = [...[1, 2, 3, 4].map((i) => mk(`f${i}`, 'friend', { context: 'club' })), ...[1, 2, 3].map((i) => mk(`a${i}`, 'acquaintance', { context: 'choir' })), mk('c1', 'close', { context: 'club' })]
  const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.removeItem('trustweb.ui.netPins') }, record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(800)
  await page.locator('[data-go="web"]').click(); await page.waitForTimeout(300)
  await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
  await page.locator('[data-view-drop] [data-view=network]').click(); await page.waitForTimeout(2500)
  check('network canvas drawn', (await page.locator('.net-canvas').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/network_trustweb.png` })
  await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(400)
  check('skins section with two skins', (await page.locator('[data-settings-skins] [data-skin]').count()) === 2)
  check('store line greyed', (await page.locator('[data-skins-store]').count()) === 1)
  check('trustweb skin on by default', (await page.locator('[data-skin="trustweb"]').getAttribute('aria-checked')) === 'true')
  await page.locator('[data-skin="classic-network"]').click(); await page.waitForTimeout(400)
  check('classic chosen and stored', (await page.locator('[data-skin="classic-network"]').getAttribute('aria-checked')) === 'true' && JSON.parse(await page.evaluate(() => localStorage.getItem('trustweb.v1.me'))).skin === 'classic-network')
  await page.reload(); await page.waitForTimeout(1500)
  await page.locator('[data-skin="classic-network"]').count()
  check('no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
