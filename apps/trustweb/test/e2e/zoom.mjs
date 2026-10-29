// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b zoom proof (headless, dev only): PORT=5457 SHOTS=<dir> EXE=<chromium> node zoom.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5457}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  const person = (i, ring) => ({ id: `p${i}`, name: `Person ${i}`, ring, lines: [], context: '', metAt: 0 })
  const people = [...Array.from({ length: 8 }, (_, i) => person(i, 'close')), ...Array.from({ length: 12 }, (_, i) => person(i + 8, 'acquaintance'))]
  const inventory = ['Ladder', 'Apple press', 'Bike pump'].map((text, i) => ({ id: `i${i}`, text, audience: 'friends-of-friends', included: true, createdAt: i + 1 }))
  await page.evaluate(([people, inventory]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people, peers: [], log: [], inventory })), [people, inventory])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  const dots = async () => (await page.locator('.rings-wrap .node').count())
  const level = (sel) => page.locator(`${sel}[data-zoom-level]`).getAttribute('data-zoom-level')
  check('opens zoomed out on Membranes', (await dots()) === 9 && (await level('.scroll')) === 'out')
  await page.locator('[data-go="chat"]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-go="web"]').tap(); await page.waitForTimeout(300)
  check('Membranes zoomed out: 8 people + hint', (await dots()) === 9 && (await page.locator('[data-zoom-hint]').count()) === 1 && (await level('.scroll')) === 'out')
  await page.screenshot({ path: `${SHOTS}/zoom-web-out.png` })
  await page.locator('[data-go="web"]').tap(); await page.waitForTimeout(300)
  check('second press: everyone, no hint, level in', (await dots()) === 21 && (await page.locator('[data-zoom-hint]').count()) === 0 && (await level('.scroll')) === 'in')
  await page.screenshot({ path: `${SHOTS}/zoom-web-in.png` })
  await page.goBack(); await page.waitForTimeout(300)
  check('Back: zoomed out again', (await dots()) === 9)
  await page.locator('[data-zoom-glyph="web"]').tap(); await page.waitForTimeout(200)
  check('glyph zooms in', (await dots()) === 21)
  await page.locator('[data-zoom-glyph="web"]').tap(); await page.waitForTimeout(300)
  check('glyph is the second way out', (await dots()) === 9)
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(300)
  check('Resources zoomed out: today\'s list', (await page.locator('.inv').count()) === 3 && (await page.locator('.zoom-row').count()) === 0)
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(300)
  check('second press: flat outliner rows', (await page.locator('.zoom-row').count()) === 3 && (await page.locator('.inv').count()) === 0)
  await page.fill('input[type=search]', 'lad'); await page.waitForTimeout(200)
  check('search filters', (await page.locator('.zoom-row').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/zoom-res-in.png` })
  await page.goBack(); await page.waitForTimeout(300)
  check('Back: Resources zoomed out', (await page.locator('.inv').count()) === 3)
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-go="web"]').tap(); await page.waitForTimeout(300)
  check('another tab leaves the zoom', (await dots()) === 9 && (await page.locator('[data-zoom-level="in"]').count()) === 0)
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
