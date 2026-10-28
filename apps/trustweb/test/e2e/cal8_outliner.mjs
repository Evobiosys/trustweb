// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal8 proof (headless, dev only): PORT=5457 SHOTS=<dir> node cal8_outliner.mjs. */
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
  const d = new Date(Date.now() + 5 * 86400000); const p2 = (n) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  await page.evaluate((day) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: [{ id: 'p1', name: 'Ana', ring: 1, lines: [], context: '' }], peers: [], log: [], inventory: [],
    events: [{ id: 'e1', name: 'Forum', from: day, where: 'Graz', people: ['p1'], createdAt: 1, attended: true }],
    tasks: [{ id: 't1', title: 'Pack the stand', due: '2020-01-01', stamp: 1 }] })), day)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(300)
  const det = page.locator('[data-cal-outliner]')
  check('folded "Calendar (2)"', (await det.count()) === 1 && !(await det.evaluate((e) => e.open)) && (await det.locator('summary').innerText()) === 'Calendar (2)')
  await det.locator('summary').tap(); await page.waitForTimeout(200)
  const t = await page.locator('[data-cal-orow="t1"]').innerText()
  const e = await page.locator('[data-cal-orow="e1"]').innerText()
  check('task row: title + status overdue', t.includes('Pack the stand') && t.includes('status: overdue'))
  check('event row: where, people, upcoming', e.includes('where: Graz') && e.includes('people: Ana') && e.includes('status: upcoming'))
  await page.locator('[data-cal-outliner]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/cal8-outliner.png` })
  await page.locator('[data-cal-orow="t1"]').tap(); await page.waitForTimeout(300)
  check('task row opens the task panel', (await page.locator('[data-task-repeat]').count()) === 1)
  await page.locator('[data-go="inventory"]').tap().catch(() => {}); await page.waitForTimeout(200)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(300)
  await page.locator('[data-cal-outliner] summary').tap(); await page.locator('[data-cal-orow="e1"]').tap(); await page.waitForTimeout(300)
  check('event row opens the event page', (await page.locator('body').innerText()).includes('Forum') && (await page.locator('[data-cal-outliner]').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/cal8-event.png` })
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
