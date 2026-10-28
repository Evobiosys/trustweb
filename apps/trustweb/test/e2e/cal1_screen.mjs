// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal1 proof (headless, dev only): PORT=5441 SHOTS=<dir> node cal1_screen.mjs. EXE=<chromium headless shell>. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5441}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const p2 = (n) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
const EV = [
  { id: 'e1', name: 'Forum Südtirol', from: `${day}T18:30`, where: 'Innsbruck', createdAt: 1, attended: true },
  { id: 'e2', name: 'Sommerfest', from: day, where: '', createdAt: 1, attended: true },
]
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ev) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: [], peers: [], log: [], events: ev })), EV)
  await page.reload(); await page.addStyleTag({ content: '.twf { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  check('the Events screen opens on the calendar', (await page.locator('.cal-grid').count()) === 1 && (await page.locator('[data-event]').count()) === 0)
  check('today is ringed and selected', (await page.locator(`.cal-day.today.sel[data-day="${day}"]`).count()) === 1)
  const box = await page.locator('.cal-day').first().boundingBox()
  check('cells are tap-sized and the grid fits 360+', box.height >= 40 && box.width >= 40)
  await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/cal1-month.png` })
  const ids = await page.locator('[data-cal-event]').evaluateAll((n) => n.map((x) => x.dataset.calEvent))
  check('agenda lists the day sorted: all-day then timed', ids.join() === 'e2,e1')
  check('time shown', (await page.locator('[data-cal-event="e1"]').innerText()).includes('18:30'))
  await page.locator('[data-cal-next]').tap(); await page.locator('[data-cal-prev]').tap()
  await page.locator('[data-cal-next]').tap(); await page.waitForTimeout(100)
  const other = await page.locator('.cal-day.other').count()
  check('next month shows dimmed neighbours and an empty day', other > 0)
  await page.locator('.cal-day:not(.other)').nth(14).tap(); await page.waitForTimeout(100)
  check('empty day text', (await page.locator('.cal-agenda .empty').count()) === 1)
  await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/cal1-empty-day.png` })
  await page.locator('[data-cal-prev]').tap(); await page.locator(`[data-day="${day}"]`).tap()
  await page.locator('[data-cal-add]').tap(); await page.waitForTimeout(200)
  check('add opens the form with From preset to the selected day', (await page.locator('input[type=date]').first().inputValue()) === day)
  await page.locator('button.back').first().tap(); await page.waitForTimeout(200)
  check('cancel returns to the calendar', (await page.locator('.cal-grid').count()) === 1)
  await page.locator('[data-cal-event="e1"]').tap(); await page.waitForTimeout(200)
  check('tap an event opens its page', (await page.locator('.events-page').count()) === 1)
  await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/cal1-event.png` })
  await page.locator('button.back').first().tap(); await page.waitForTimeout(200)
  check('back from the event page lands on the calendar', (await page.locator('.cal-grid').count()) === 1)
  await page.locator('[data-cal-all]').tap(); await page.waitForTimeout(200)
  check('All events shows the old list', (await page.locator('[data-event]').count()) === 2 && (await page.locator('[data-event-paste]').count()) === 1)
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
