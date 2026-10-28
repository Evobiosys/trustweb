// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal3 proof (headless, dev only): PORT=5451 SHOTS=<dir> EXE=<chromium headless shell> node cal3_tasks.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5451}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const p2 = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const now = new Date()
const today = iso(now)
const nextWeek = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
const ITEM = { id: 'i1', text: 'Spare bike wheels', audience: 'close', included: true, createdAt: 1 }
const rec = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
let page
try {
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((item) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: [], peers: [], log: [], inventory: [item] })), ITEM)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  await page.locator('[data-cal-mode="tasks"]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-task-add]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-task-title]').fill('Water the plants')
  await page.locator('[data-task-due]').fill(today)
  await page.locator('[data-task-repeat]').selectOption('weekly')
  await page.locator('[data-task-save]').tap(); await page.waitForTimeout(200)
  check('the task is in the Tasks list', (await page.locator('[data-cal-task]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/cal3-tasks.png` })
  await page.locator('[data-cal-mode="calendar"]').tap(); await page.waitForTimeout(200)
  check('a task due today shows in the calendar agenda', (await page.locator('.cal-agenda [data-cal-task]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/cal3-agenda.png` })
  await page.locator('.cal-agenda [data-task-done]').tap(); await page.waitForTimeout(200)
  let tasks = (await rec()).tasks
  check('ticking leaves the next weekly occurrence', tasks.length === 2 && tasks.some((t) => t.done) && tasks.some((t) => !t.done && t.due === nextWeek))
  await page.locator('[data-cal-mode="tasks"]').tap(); await page.waitForTimeout(200)
  check('done folds under Done (1), next one is open', (await page.locator('[data-task-folded] summary').innerText()).includes('1') && (await page.locator('.cal-task:not(.done)').count()) === 1)
  // delete + undo
  await page.locator('.cal-task:not(.done) .cal-task-open').tap(); await page.waitForTimeout(200)
  await page.locator('[data-task-add-sub]').scrollIntoViewIfNeeded()
  await page.locator('[data-task-add-sub]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-task-title]').fill('Buy water')
  await page.locator('[data-task-save]').tap(); await page.waitForTimeout(200)
  tasks = (await rec()).tasks
  check('a subtask holds its parent', tasks.some((t) => t.title === 'Buy water' && t.parentId))
  // item reminder
  await page.locator('.tab[data-go="inventory"], [data-go="inventory"]').first().tap(); await page.waitForTimeout(300)
  await page.locator('[data-item="i1"]').tap(); await page.waitForTimeout(300)
  await page.locator('[data-item-remind]').scrollIntoViewIfNeeded()
  await page.locator('[data-item-remind]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-remind-at]').fill(`${nextWeek}T09:00`)
  await page.locator('[data-remind-why]').selectOption('ask')
  await page.screenshot({ path: `${SHOTS}/cal3-item-remind.png` })
  await page.locator('[data-remind-save]').tap(); await page.waitForTimeout(200)
  tasks = (await rec()).tasks
  const r = tasks.find((t) => t.resourceId === 'i1')
  check('Remind me makes a task linked to the item', !!r && r.resourceWhy === 'ask' && r.title === 'Ask about: Spare bike wheels' && typeof r.remindAt === 'number')
  // a due reminder shows a notice once and opens the item
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.tasks.find((t) => t.resourceId === 'i1').remindAt = 1; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)); localStorage.removeItem('tw-cal-fired') })
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1500)
  check('a due reminder shows a notice', (await page.locator('[data-reminder-open]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/cal3-reminder.png` })
  await page.locator('[data-reminder-open]').tap(); await page.waitForTimeout(300)
  check('its tap opens the item', (await page.locator('[data-item-remind]').count()) === 1)
  const fired = await page.evaluate(() => JSON.parse(localStorage.getItem('tw-cal-fired')))
  check('fired once, kept outside the record', fired.length === 1 && !JSON.stringify(await rec()).includes('tw-cal-fired'))
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
