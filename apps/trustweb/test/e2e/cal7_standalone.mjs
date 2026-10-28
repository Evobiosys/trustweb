// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal7 proof (headless, dev only): PORT=5456 SHOTS=<dir> node cal7_standalone.mjs. Synthetic DataTransfer drags (phone viewport: the drag events are synthetic, the app only listens for them). */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5456}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  const today = new Date(); const p2 = (n) => String(n).padStart(2, '0')
  const day = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`
  await page.evaluate((d) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: [{ id: 'p1', name: 'Ana', ring: 1, lines: [], context: '' }], peers: [], log: [], inventory: [],
    events: [{ id: 'e1', name: 'Forum', from: d, where: 'Graz', createdAt: 1, attended: true }] })), day)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  const row = '[data-cal-event="e1"]'
  check('agenda row is draggable', (await page.locator(row).getAttribute('draggable')) === 'true')
  await page.locator(row).tap(); await page.waitForTimeout(300)
  check('event page title is draggable', (await page.locator('.hdr, header').first().getAttribute('draggable')) === 'true')
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await page.locator('.events-btn').tap(); await page.waitForTimeout(300)
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await page.locator(row).dispatchEvent('dragstart', { dataTransfer: dt })
  const got = await page.evaluate((d) => [d.getData('text/x-trustweb-event'), d.getData('text/plain')], dt)
  check('payload carries id + name only, plain text is the label', got[0] === '{"id":"e1","name":"Forum"}' && got[1].startsWith('Forum'))
  await page.locator('[data-go="inventory"]').tap(); await page.waitForTimeout(300)
  await page.locator('.scroll.pad').dispatchEvent('drop', { dataTransfer: dt })
  await page.waitForTimeout(300)
  check('drop adds the item, undo notice shown', (await page.locator('.inv-text').first().innerText()).startsWith('Forum') && (await page.locator('[data-undo-event]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/cal7-dropped.png` })
  await page.locator('[data-undo-event]').tap(); await page.waitForTimeout(200)
  check('undo removes it', (await page.locator('.inv-text').count()) === 0)
  const bad = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData('text/x-trustweb-event', '{"id":"zz","name":"Other"}'); return d })
  await page.locator('.scroll.pad').dispatchEvent('drop', { dataTransfer: bad }); await page.waitForTimeout(300)
  check('unknown event adds nothing and toasts', (await page.locator('.inv-text').count()) === 0 && (await page.locator('body').innerText()).includes('nothing was added'))
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
