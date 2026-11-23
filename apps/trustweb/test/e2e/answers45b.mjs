// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 answers-45b (headless, STOCK dev server only, synthetic record, fake names): demo-overlay undo in Settings (1280), the event page's
 * "Web: just people from this event" (360 + 1280), the Closest/Close follow switch in Share settings, the Google one-time-import line.
 * TW_STOCK=1 TW_PORT=5496 scripts/tw_dev.sh --no-open; PORT=5496 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node answers45b.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5496}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const people = [
  { id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, events: ['e1'], peerId: 'peer-p1' },
  { id: 'p2', name: 'Cara Lenz', ring: 'close', lines: [], context: '', metAt: 1, peerId: 'peer-p2' },
]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, host: 'Ana' }
const record = (extra = {}) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [EV], ...extra })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const dots = (page) => page.evaluate(() => [...document.querySelectorAll('.node[data-pid]')].map((n) => n.dataset.pid).sort())
const openEvent = async (page) => {
  await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
  if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
  await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(600)
}
const settings = async (page) => {
  if (await page.locator('[data-keep-copy-offer]').count()) { await page.locator('[data-keep-copy-offer] ~ .btn-ghost').click().catch(() => {}); await page.waitForTimeout(300) }
  await page.locator('[data-settings-gear]').first().click(); await page.locator('.sheet.on[data-kind=settings]').waitFor({ timeout: 5000 })
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    ctx.setDefaultTimeout(5000)
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    const load = async (extra, ls = {}) => {
      await page.evaluate(([r, more]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v); sessionStorage.clear() }, [record(extra), ls])
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1000); await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
      await page.locator('.sheet.on button:has-text("Not now")').click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300)   // the once-only Keep a copy offer
    }
    // ---- 4: event page button -> Web with the bubble on (an earlier Everyone lift ends)
    await load({ uiRings: { eventMode: 'e1', eventEveryone: true } })
    check(`${w}: lifted (Everyone) = both people`, (await dots(page)).join() === 'p1,p2', (await dots(page)).join())
    await openEvent(page)
    const btn = page.locator('[data-event-web-bubble]')
    check(`${w}: button shown beside Event chat, same style (chip ev-act)`, (await btn.count()) === 1 && (await btn.getAttribute('class')) === 'chip ev-act' && (await btn.innerText()).trim() === 'Web: just people from this event', String(await btn.count()))
    if (await btn.count()) {
      const chat = page.locator('[data-event-chat]')
      if (await chat.count()) { const a = await chat.boundingBox(), b = await btn.boundingBox(); check(`${w}: same height as Event chat`, Math.abs(a.height - b.height) < 2, `${a.height} vs ${b.height}`) }
      await page.screenshot({ path: `${SHOTS}/answers-45b-event-button-${w}.png` })
      await btn.click(); await page.waitForTimeout(900)
      check(`${w}: Web shows only the event's person`, (await dots(page)).join() === 'p1', (await dots(page)).join())
      check(`${w}: chip Everyone there to lift it`, (await page.locator('[data-event-everyone]').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/answers-45b-web-bubble-${w}.png` })
      await page.locator('[data-event-everyone]').click(); await page.waitForTimeout(500)
      check(`${w}: Everyone lifts it`, (await dots(page)).join() === 'p1,p2', (await dots(page)).join())
    }
    await load({ eventBubbleOff: true })
    await openEvent(page)
    check(`${w}: bubble switched off in Settings = no button`, (await page.locator('[data-event-web-bubble]').count()) === 0 && (await page.locator('[data-event-chat]').count()) === 1)
    // ---- 5: Share settings switch + per person
    await load({})
    await settings(page)
    const share = page.locator('[data-settings-share]')
    if (await share.count()) { await share.locator('summary').click(); await page.waitForTimeout(300) }
    const sw = page.locator('[data-ss-close-auto]')
    check(`${w}: Closest/Close switch on by default`, (await sw.count()) === 1 && (await sw.getAttribute('aria-pressed')) === 'true')
    await page.screenshot({ path: `${SHOTS}/answers-45b-close-follow-${w}.png` })
    await sw.click(); await page.waitForTimeout(400)
    check(`${w}: switched off = struck through, Per person hidden`, (await page.locator('[data-ss-close-auto]').getAttribute('class')).includes('tw-off') && (await page.locator('[data-ss-close-people]').count()) === 0)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).settingsShare?.closeAsk)
    check(`${w}: stored in the record (closeAsk)`, stored === true, String(stored))
    // ---- 1: demo overlay undo (the overlay shows on a wide tab only)
    if (w === 1280) {
      await load({}, {})
      await page.locator('[data-demo-overlay-x]').click(); await page.waitForTimeout(300)
      check('1280: X hides the overlay', await page.locator('[data-demo-overlay]').isHidden())
      await settings(page)
      const again = page.locator('.sheet.on [data-demo-overlay-again]')
      check('1280: Settings offers "Show the demo-content button again"', (await again.count()) === 1 && (await again.textContent()).includes('Show the demo-content button again'), `${await again.count()} ${await page.locator('[data-demo-overlay-again]').count()} ${await page.evaluate(() => localStorage.getItem('trustweb.ui.demo-overlay-dismissed'))}`)
      await page.waitForTimeout(800)   // Share settings reads the relay once when Settings opens and redraws the sheet
      await again.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.screenshot({ path: `${SHOTS}/answers-45b-demo-again-1280.png` })
      await again.evaluate((e) => e.click()); await page.waitForTimeout(400)
      check('1280: the overlay is back, the row gone', await page.locator('[data-demo-overlay]').isVisible() && (await page.locator('[data-demo-overlay-again]').count()) === 0)
    }
    // ---- 6: Google import line (Connect Google behind its flag)
    await load({}, { 'tw-google-connect': '1' })
    await settings(page)
    await page.locator('[data-settings-import-bottom]').first().evaluate((b) => b.click()); await page.waitForTimeout(800)
    const once = page.locator('[data-google-once]')
    check(`${w}: Google sheet shows the one-time line`, (await once.count()) >= 1 && (await once.first().innerText()).startsWith('Ideally this is a one-time import.'))
    if (await once.count()) { await once.first().evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.screenshot({ path: `${SHOTS}/answers-45b-google-once-${w}.png` }) }
    check(`${w}: no document scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${w}: no page errors`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
