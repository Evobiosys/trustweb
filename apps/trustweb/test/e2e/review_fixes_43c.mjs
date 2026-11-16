// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * review-fixes-43c (headless, stock dev server, synthetic record): PORT=5462 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<index.mjs> node review_fixes_43c.mjs
 *  A. Jakob Ω: Settings "Default view of Contacts" (bottom-row sheet select) shows the chosen view on the Web screen at once, without another tap.
 *  B. Jakob Ω (shot-toast-overflow-tools.png): with Tools open, a long toast and an ask-result card sit inside the viewport, above the bottom bar,
 *     and are not covered (360x780 and 1280x900).
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5462}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const record = () => ({
  v: 1, me: { id: 'me1', displayName: 'Tester Person' }, peers: [], log: [], inventory: [], events: [], missedPopupOff: true,
  people: [{ id: 'p1', name: 'Ana Muster', ring: 'close', lines: [], context: '', peerId: 'x1' }, { id: 'p2', name: 'Ben Beispiel', ring: 'friend', lines: [], context: '' }],
  unmatchedAsks: [{ id: 'u1', at: Date.now(), peerId: 'x1', from: 'Ana Muster', text: 'Does anyone know a very long question that wraps over several lines in the card and keeps going?', reason: 'nothing' }],
})
const inside = (b, vw, vh) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vw + 0.5 && b.y + b.height <= vh + 0.5
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); localStorage.removeItem('trustweb.ui.webView') }, record())
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1000)

    // ---- A. default view of Contacts, from the bottom-row sheet
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    check(`${w}: A. the rings show first (no Find-by-name of the Network view)`, (await page.locator('[data-social-find]').count()) === 0)
    await page.locator('[data-bar-more]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-bar-open-settings]').first().click(); await page.waitForTimeout(400)
    const sel = page.locator('[data-web-default]').first()
    check(`${w}: A. the sheet offers "Default view of Contacts"`, (await sel.count()) === 1 && (await sel.getAttribute('aria-label')) === 'Default view of Contacts')
    await sel.selectOption('network'); await page.waitForTimeout(600)
    check(`${w}: A. the Web screen behind the sheet shows Network at once`, (await page.locator('[data-social-find]').count()) === 1)
    await page.keyboard.press('Escape'); await page.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(300)
    check(`${w}: A. stored as the default (uiViews.webDefault)`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).uiViews?.webDefault)) === 'network')
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.uiViews; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); localStorage.setItem('trustweb.ui.webView', 'rings') })
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1000)

    // ---- B. Tools open + a long toast + the ask-result card
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(300)
    // a phone opens Tools as a sheet; wide screens show it inline and open by default
    if ((await page.locator('[data-zone-side-toggle]').first().getAttribute('aria-expanded')) !== 'true') { await page.locator('[data-zone-side-toggle]').first().click(); await page.waitForTimeout(500) }
    const toolsOpen = w < 600 ? (await page.locator('.sheet.on').count()) === 1 : (await page.locator('[data-zone-side-toggle]').first().getAttribute('aria-expanded')) === 'true'
    check(`${w}: B. Tools is open (${w < 600 ? 'sheet' : 'inline'})`, toolsOpen)
    await page.evaluate(() => {
      const t = document.querySelector('#notice-layer .toast')
      t.textContent = 'Asked 12 people in Closest and Close: three answers are waiting for you under Ask, and one person passed it on to two friends.'
      t.classList.add('on')
    })
    await page.waitForTimeout(400)
    const toast = await page.locator('#notice-layer .toast.on').boundingBox()
    const card = await page.locator('#notice-layer [data-card-stack]').first().boundingBox()
    const tabs = await page.locator('nav.tabs').boundingBox()
    check(`${w}: B. the toast sits inside the viewport`, inside(toast, w, h), JSON.stringify(toast))
    check(`${w}: B. the ask-result card sits inside the viewport`, inside(card, w, h), JSON.stringify(card))
    check(`${w}: B. neither covers the bottom bar`, !!tabs && toast.y + toast.height <= tabs.y + 1 && (!card || card.y + card.height <= tabs.y + 1), JSON.stringify({ toast, card, tabs }))
    // the layer is pointer-events:none (taps pass through); for the hit test the toast takes pointer events for a moment
    const onTop = await page.evaluate(() => { const t = document.querySelector('#notice-layer .toast.on'); const old = t.style.pointerEvents; t.style.pointerEvents = 'auto'; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); t.style.pointerEvents = old; return !!e && t.contains(e) })
    check(`${w}: B. the toast is not covered by the Tools ${w < 600 ? 'sheet' : 'panel'}`, onTop)
    await page.screenshot({ path: `${SHOTS}/review-fixes-43c-tools-toast-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
