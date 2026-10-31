// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 26 membrane-offset (headless): name labels of the Membranes page never overlap, phone and desktop.
 *  PORT=5470 node membrane_offset.mjs (DEV=1 against a TW_DEV_RECORD server; else seeds 5 people on each ring). PW_CORE, EXE, SHOT=<dir> as in fit_screen.mjs. */
const { chromium } = await import(process.env.PW_CORE ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5470}/`
const RINGS = ['closest', 'close', 'friend', 'acquaintance']
const names = ['Anna Huber', 'Ben Gruber', 'Clara Moser', 'David Lang', 'Eva Berger']
const people = RINGS.flatMap((ring, r) => names.slice(0, Number(process.env.N ?? 5)).map((n, i) => ({ id: `${ring}${i}`, name: `${n} ${r}`, context: '', ring, metAt: 1, lines: [] })))
const REC = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], people }
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1200)
  if (!process.env.DEV) { await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC); await page.reload() }
  await page.addStyleTag({ content: '.twf { display: none !important }' }); await page.waitForTimeout(800)
  await page.locator('.tab[data-go=web]:visible').first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(900)
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/${w}x${h}-membranes.png` })
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you) > span')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, x: r.left, y: r.top, r: r.right, b: r.bottom, vis: r.width > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' } }).filter((b) => b.vis))
  const hits = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b) hits.push(`${a.t} x ${c.t}`) }
  console.log(`${hits.length || errors.length ? 'FAIL' : 'PASS'}  ${w}x${h} labels=${boxes.length} overlaps=${hits.length} ${hits.slice(0, 3).join('; ')} ${errors[0] ?? ''}`)
  if (hits.length || errors.length || boxes.length === 0) failed = true
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
