// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 whatsapp-desktop proof (headless, dev only): PORT=5472 SHOTS=<dir> EXE=<chromium> node whatsapp_window.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5472}/`
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
  await page.locator('[data-go="chat"]').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.locator('[data-chat-source-pill]').click(); await page.locator('[data-chat-source-open="whatsapp"]').click()
  await page.waitForTimeout(300)
  check('WhatsApp page open', (await page.locator('[data-page="whatsapp-window"], [data-wa-open]').count()) > 0)
  await page.screenshot({ path: `${SHOTS}/whatsapp-page-1440.png` })
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 4000 }).catch(() => null), page.locator('[data-wa-open]').click()])
  check('click opens a tab at web.whatsapp.com', popup !== null && popup.url().startsWith('https://web.whatsapp.com'))
  check('split hint shown (desktop Chromium)', await page.locator('[data-wa-hint]').isVisible())
  const n = ctx.pages().length
  await page.locator('[data-wa-open]').click(); await page.waitForTimeout(500)
  check('second click reuses the tab', ctx.pages().length === n)
  await page.screenshot({ path: `${SHOTS}/whatsapp-opened-1440.png` })
  await page.locator('[data-wa-close]').click(); await page.waitForTimeout(500)
  check('Close WhatsApp closes only that tab', ctx.pages().length === n - 1 && !page.isClosed())
  check('no page errors (desktop)', errors.length === 0)
  await ctx.close()

  // Person card: the WhatsApp button is wa.me until the WhatsApp tab is open, then it is the same chat on WhatsApp Web in that tab
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const c = await start(ctx1)
  const card = async () => { await c.page.locator('[data-go="web"]').first().click({ timeout: 3000 }).catch(() => {}); await c.page.locator('[data-pid="p1"]').click(); await c.page.waitForTimeout(400) }
  await card()
  check('card button is wa.me before the tab is open', ((await c.page.locator('a[data-wa-person="p1"]').getAttribute('href')) ?? '').startsWith('https://wa.me/4366012345'))
  await c.page.reload(); await c.page.waitForTimeout(800)
  await c.page.locator('[data-go="chat"]').first().click(); await c.page.locator('[data-chat-source-pill]').click(); await c.page.locator('[data-chat-source-open="whatsapp"]').click()
  const [wa] = await Promise.all([c.page.waitForEvent('popup', { timeout: 4000 }).catch(() => null), c.page.locator('[data-wa-open]').click()])
  for (let i = 0; i < 4 && !(await c.page.locator('[data-pid="p1"]').isVisible()); i++) { await c.page.evaluate(() => history.back()); await c.page.waitForTimeout(500); await c.page.locator('[data-go="web"]').first().click({ timeout: 800 }).catch(() => {}) }
  await c.page.locator('[data-pid="p1"]').click(); await c.page.waitForTimeout(400)
  const n1 = ctx1.pages().length
  await c.page.locator('a[data-wa-person="p1"]').click(); await c.page.waitForTimeout(800)
  check('person button reuses the tab, no new one', wa !== null && ctx1.pages().length === n1)
  check('the tab now shows the web.whatsapp.com/send chat', wa !== null && wa.url().startsWith('https://web.whatsapp.com/send?phone=4366012345'))
  await c.page.screenshot({ path: `${SHOTS}/whatsapp-card-1440.png` })
  check('no page errors (card)', c.errors.length === 0)
  await ctx1.close()

  // Blocked tab
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const b = await start(ctx2)
  await b.page.addInitScript(() => { window.open = () => null })
  await b.page.evaluate(() => { window.open = () => null })
  await b.page.locator('[data-go="chat"]').first().click().catch(() => {})
  await b.page.locator('[data-chat-source-pill]').click(); await b.page.locator('[data-chat-source-open="whatsapp"]').click()
  await b.page.locator('[data-wa-open]').click(); await b.page.waitForTimeout(300)
  check('blocked popup shows a visible line', await b.page.locator('[data-wa-blocked]').isVisible())
  await b.page.screenshot({ path: `${SHOTS}/whatsapp-blocked-1440.png` })
  await ctx2.close()

  // Phone: wa.me link only
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const m = await start(ctx3)
  await m.page.locator('[data-go="chat"]').first().tap().catch(() => {})
  await m.page.locator('[data-chat-source-pill]').tap(); await m.page.locator('[data-chat-source-open="whatsapp"]').tap()
  await m.page.waitForTimeout(300)
  check('phone: link to wa.me, no window', (await m.page.locator('a[data-wa-open][href="https://wa.me/"]').count()) === 1)
  await m.page.screenshot({ path: `${SHOTS}/whatsapp-page-390.png` })
  check('no page errors (phone)', m.errors.length === 0)
  await ctx3.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
