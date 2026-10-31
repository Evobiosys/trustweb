// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 chat-row proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> node chat_row.mjs. */
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
    people: [{ id: 'p1', name: 'Ana', ring: 1, lines: [], context: '', peerId: 'x1', channels: { signal: '+436601234567' }, theirChannels: { matrix: '@ana:example.org' } }] })))
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  await page.locator('[data-pid="p1"]').tap(); await page.waitForTimeout(400)
  check('chat row mounted', (await page.locator('[data-chat-row="p1"]').count()) === 1)
  check('menu starts closed', !(await page.locator('[data-chat-menu="p1"]').isVisible()))
  await page.locator('[data-chat-caret="p1"]').tap(); await page.waitForTimeout(200)
  check('menu lists TrustWeb, Signal, Matrix', (await page.locator('[data-chat-service]').count()) === 3)
  await page.screenshot({ path: `${SHOTS}/chat-row-menu-390.png` })
  await page.locator('[data-chat-pin="ch:matrix"]').tap(); await page.waitForTimeout(200)
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).chatPrefs)
  check('pin saved', prefs?.p1?.pinned === 'ch:matrix')
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), page.locator('[data-chat-open="p1"]').tap()])
  check('Chat opens the pinned service', popup !== null && popup.url().startsWith('https://matrix.to/'))
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).chatPrefs)
  check('use recorded', typeof after?.p1?.lastUsed?.['ch:matrix'] === 'number')
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `${SHOTS}/chat-row-1440.png` })
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
