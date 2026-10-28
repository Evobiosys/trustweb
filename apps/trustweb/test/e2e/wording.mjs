// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b wording proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium headless shell> node wording.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const PEOPLE = [{ id: 'p1', name: 'Anna', peerId: 'peer-anna' }, { id: 'p2', name: 'Bruno' }, { id: 'p3', name: 'Carla', peerId: 'peer-carla' }]
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((people) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people, peers: [], log: [], inventory: [] })), PEOPLE)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  const label = (await page.locator('.tab[data-go="inventory"]').innerText()).trim()
  check('the bottom row says Resources', label === 'Resources')
  await page.screenshot({ path: `${SHOTS}/wording-bottom-row.png` })
  await page.locator('.tab[data-go="chat"]').tap(); await page.waitForTimeout(300)
  await page.locator('[data-chat-new]').tap(); await page.waitForTimeout(300)
  const rows = await page.locator('[data-chat-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-pick')))
  check('picker lists connected people first', rows.join() === 'p1,p3,p2')
  check('the unconnected person says not on TrustWeb yet', (await page.locator('[data-chat-pick="p2"]').innerText()).includes('not on TrustWeb yet'))
  await page.screenshot({ path: `${SHOTS}/wording-picker.png` })
  await page.locator('[data-chat-pick="p1"]').tap(); await page.waitForTimeout(400)
  check('picking opens the chat with that person', (await page.locator('.sheet.on').innerText()).includes('Anna'))
  await page.screenshot({ path: `${SHOTS}/wording-chat.png` })
  check('no page errors', errors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
