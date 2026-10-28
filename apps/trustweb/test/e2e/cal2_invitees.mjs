// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal2 proof (headless, dev only): PORT=5450 SHOTS=<dir> EXE=<chromium headless shell> node cal2_invitees.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5450}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const p2 = (n) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
const EV = [{ id: 'e1', name: 'Forum Südtirol', from: day, where: 'Innsbruck', createdAt: 1, attended: true }]
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...extra })
const PEOPLE = [person('p1', 'Anna Berger', { peerId: 'peer1' }), person('p2', 'Ben Moser')]
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate(([ev, people]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people, peers: [], log: [], events: ev })), [EV, PEOPLE])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  // drop on the agenda row
  await page.locator('[data-cal-event="e1"]').evaluate((n) => {
    const dt = new DataTransfer()
    dt.setData('text/x-trustweb-person', JSON.stringify({ id: 'p2', name: 'Ben Moser' }))
    n.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    n.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(200)
  await page.locator('[data-cal-event="e1"]').tap(); await page.waitForTimeout(200)
  check('a person dropped on the agenda row is invited', (await page.locator('[data-cal-invitee="p2"]').count()) === 1)
  check('no send button without a peer; honest hint', (await page.locator('[data-cal-send="p2"]').count()) === 0 && (await page.locator('[data-cal-invitee="p2"]').innerText()).includes('Not on TrustWeb'))
  await page.locator('[data-cal-invite-add]').scrollIntoViewIfNeeded(); await page.locator('[data-cal-invite-add]').tap(); await page.waitForTimeout(200)
  check('picker lists only people not invited', (await page.locator('[data-cal-pick="p1"]').count()) === 1 && (await page.locator('[data-cal-pick="p2"]').count()) === 0)
  await page.locator('[data-cal-pick="p1"]').tap(); await page.waitForTimeout(200)
  check('picked person shows as invitee with Send invite', (await page.locator('[data-cal-invitee="p1"]').count()) === 1 && (await page.locator('[data-cal-send="p1"]').count()) === 1)
  check('the attendees list is untouched', (await page.locator('[data-attendee]').count()) === 0)
  await page.locator('[data-cal-invitees]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/cal2-invitees.png` })
  await page.locator('[data-cal-uninvite="p2"]').tap(); await page.waitForTimeout(200)
  check('remove x drops the invitee', (await page.locator('[data-cal-invitee="p2"]').count()) === 0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).events[0].people)
  check('saved as person ids on the event', saved?.join() === 'p1')
  // a drop of an unknown id adds nothing
  await page.locator('[data-cal-invitees]').evaluate((n) => {
    const dt = new DataTransfer(); dt.setData('text/x-trustweb-person', JSON.stringify({ id: 'nobody', name: 'X' }))
    n.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(200)
  check('an unknown id is ignored', (await page.locator('[data-cal-invitee]').count()) === 1)
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
