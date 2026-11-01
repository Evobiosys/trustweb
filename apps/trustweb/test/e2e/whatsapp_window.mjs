// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 whatsapp-window proof (headless, dev only): PORT=5421 SHOTS=<dir> EXE=<chromium> node whatsapp_window.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5421}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p1', name: 'Ana', ring: 1, lines: [], context: '', channels: { whatsapp: '+436601234567' } }] }
async function start(ctx) {
  await ctx.route(/whatsapp\.com|wa\.me/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); localStorage.setItem('trustweb.ui.chatExtend', '1') }, record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  return { page, errors }
}
try {
  // Desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { page, errors } = await start(ctx)
  await page.locator('[data-tab="chat"], [data-screen="chat"], nav [aria-label*="hat"]').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.locator('[data-msg-setup-src="whatsapp"]').click()
  await page.waitForTimeout(300)
  check('WhatsApp page open', (await page.locator('[data-page="whatsapp-window"], [data-wa-open]').count()) > 0)
  await page.screenshot({ path: `${SHOTS}/whatsapp-page-1440.png` })
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 4000 }).catch(() => null), page.locator('[data-wa-open]').click()])
  check('click opens a popup at web.whatsapp.com', popup !== null && popup.url().startsWith('https://web.whatsapp.com'))
  const geo = await page.evaluate(() => JSON.parse(localStorage.getItem('uiWhatsappWindow')))
  check('geometry remembered (uiWhatsappWindow)', geo && geo.width === 700)
  const n = ctx.pages().length
  await page.locator('[data-wa-open]').click(); await page.waitForTimeout(500)
  check('second click reuses the window', ctx.pages().length === n)
  await page.screenshot({ path: `${SHOTS}/whatsapp-opened-1440.png` })
  check('no page errors (desktop)', errors.length === 0)
  await ctx.close()

  // Card: Chat on a WhatsApp number goes into the same window
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const c = await start(ctx1)
  await c.page.locator('[data-pid="p1"]').click(); await c.page.waitForTimeout(400)
  const [wa] = await Promise.all([c.page.waitForEvent('popup', { timeout: 4000 }).catch(() => null), c.page.locator('[data-chat-open="p1"]').click()])
  check('card Chat opens wa.me in the WhatsApp window', wa !== null && wa.url().startsWith('https://wa.me/4366012345'))
  await c.page.screenshot({ path: `${SHOTS}/whatsapp-card-1440.png` })
  check('no page errors (card)', c.errors.length === 0)
  await ctx1.close()

  // Blocked popup
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const b = await start(ctx2)
  await b.page.addInitScript(() => { window.open = () => null })
  await b.page.evaluate(() => { window.open = () => null })
  await b.page.locator('[data-tab="chat"], [data-screen="chat"], nav [aria-label*="hat"]').first().click().catch(() => {})
  await b.page.locator('[data-msg-setup-src="whatsapp"]').click()
  await b.page.locator('[data-wa-open]').click(); await b.page.waitForTimeout(300)
  check('blocked popup shows a visible line', await b.page.locator('[data-wa-blocked]').isVisible())
  await b.page.screenshot({ path: `${SHOTS}/whatsapp-blocked-1440.png` })
  await ctx2.close()

  // Phone: wa.me link only
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const m = await start(ctx3)
  await m.page.locator('[data-tab="chat"], [data-screen="chat"], nav [aria-label*="hat"]').first().tap().catch(() => {})
  await m.page.locator('[data-msg-setup-src="whatsapp"]').tap()
  await m.page.waitForTimeout(300)
  check('phone: link to wa.me, no window', (await m.page.locator('a[data-wa-open][href="https://wa.me/"]').count()) === 1)
  await m.page.screenshot({ path: `${SHOTS}/whatsapp-page-390.png` })
  check('no page errors (phone)', m.errors.length === 0)
  await ctx3.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
