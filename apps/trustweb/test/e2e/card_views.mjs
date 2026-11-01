// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b card-views proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> node card_views.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate(() => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
    people: [
      { id: 'p1', name: 'Ana', ring: 1, lines: [], context: '', peerId: 'x1', channels: { signal: '+436601234567' } },
      { id: 'p2', name: 'Ben', ring: 1, lines: [], context: '' },
    ] })))
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  const cls = (id) => page.locator(`[data-pid="${id}"] .ava`).evaluate((e) => e.classList.contains('unconnected'))
  check('connected bubble filled, unconnected outlined', !(await cls('p1')) && (await cls('p2')))
  await page.screenshot({ path: `${SHOTS}/card-views-rings.png` })
  await page.locator('[data-pid="p1"]').tap(); await page.waitForTimeout(400)
  check('Chat button with the chat icon', (await page.locator('[data-card-chat="p1"] svg').count()) === 1 && (await page.locator('[data-card-chat="p1"]').innerText()) === 'Chat')
  check('channel glyph row shows Signal only', (await page.locator('[data-card-ch]').count()) === 1 && (await page.locator('[data-card-ch="signal"]').count()) === 1)
  check('Curate is a button, not an unfold', (await page.locator('button[data-card-curate]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/card-views-connect.png` })
  await page.locator('[data-card-ch-edit="signal"]').tap()
  await page.locator('.tap-edit-input').fill('+436609999999'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  check('tap-edit saves a channel value', (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].channels.signal)) === '+436609999999')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.locator('[data-pid="p2"]').tap(); await page.waitForTimeout(400)
  check('unconnected card: Chat button says why', (await page.locator('[data-card-chat="p2"]').count()) === 1 && (await page.locator('.card-chat .meta').innerText()).includes('connected on TrustWeb yet'))
  await page.screenshot({ path: `${SHOTS}/card-views-unconnected.png` })
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
