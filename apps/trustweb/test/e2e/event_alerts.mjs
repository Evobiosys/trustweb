// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-event-visibility-2 proof (headless, stock dev server): PORT=5301 PW=<playwright-core index.js> EXE=<chromium> node event_alerts.mjs. Settings > Notifications "Alert me about new events in my communities". Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5301}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [] }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    const sw = page.locator('[data-event-alerts]')
    await page.evaluate(() => { for (let d = document.querySelector('[data-event-alerts]'); d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true }); await page.waitForTimeout(300)
    await sw.scrollIntoViewIfNeeded()
    check(`${tag}: the row sits in Notifications, on by default`, (await sw.getAttribute('aria-pressed')) === 'true' && (await sw.innerText()).includes('Alert me about new events in my communities'))
    await sw.click(); await page.waitForTimeout(500)
    check(`${tag}: switching off stores eventAlerts=false`, (await rec(page)).eventAlerts === false)
    check(`${tag}: the row shows off`, (await page.locator('[data-event-alerts]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-event-alerts]').click(); await page.waitForTimeout(500)
    check(`${tag}: switching on stores nothing (default)`, !('eventAlerts' in (await rec(page))))
    const box = await page.locator('[data-event-alerts]').boundingBox()
    check(`${tag}: row inside the viewport width`, !!box && box.x >= 0 && box.x + box.width <= w + 1)
    check(`${tag}: no page errors`, errors.length === 0)
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
