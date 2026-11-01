// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 sovereign-import proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node sovereign_import.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Test Owner' }, peers: [], log: [], inventory: [], people: [] })
try {
  for (const [name, opts] of [
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('.hdr-btn.icon-only[aria-label*="ettings"]').first().click(); await page.waitForTimeout(400)
    await page.evaluate(() => { for (let e = document.querySelector('[data-settings-sovereign]'); e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true })
    await page.locator('[data-settings-sovereign]').scrollIntoViewIfNeeded()
    await page.locator('[data-settings-sovereign]').click(); await page.waitForTimeout(500)
    const ids = await page.locator('[data-sov-service]').evaluateAll((l) => l.map((e) => e.dataset.sovService))
    check(`${name}: title says import, WhatsApp first then Google ... Reddit`, /Import everything/.test(await page.locator('[data-page]').innerText()) && ids.slice(0, 9).join() === 'whatsapp,google,facebook,instagram,x,linkedin,amazon,spotify,reddit')
    check(`${name}: Other services folded, holds Strava`, (await page.locator('[data-sov-section="other"]').evaluate((e) => e.open)) === false && (await page.locator('[data-sov-section="other"] [data-sov-service="strava"]').count()) === 1)
    check(`${name}: estimate shown, look-out under a fold`, (await page.locator('[data-sov-estimate="google"]').count()) === 1 && (await page.locator('[data-sov-watchfor="google"]').evaluate((e) => e.open)) === false)
    check(`${name}: erasure, export and be-forgotten absent while Advanced is closed`, (await page.locator('[data-sov-erase], [data-sov-export], [data-sov-forget]').count()) === 0)
    check(`${name}: two-way sync disabled, mail connect disabled and marked not built`, (await page.locator('[data-sov-sync]').isDisabled()) && (await page.locator('[data-sov-mail-connect]').isDisabled()))
    await page.screenshot({ path: `${SHOTS}/${name}-default.png` })
    await page.locator('[data-sov-section="watch"] > summary').click()
    await page.locator('[data-sov-watch="google"] [data-sov-watch-start]').click()
    await page.locator('[data-sov-watch="google"] [data-sov-watch-arrived]').click()
    check(`${name}: watcher waiting -> link arrived`, /link arrived/.test(await page.locator('[data-sov-watch-state="google"]').innerText()))
    await page.locator('[data-sov-watch="google"] [data-sov-watch-import]').click()
    await page.locator('[data-sov-watch="google"] [data-sov-watch-imported]').click()
    check(`${name}: watcher importing -> done`, /done/.test(await page.locator('[data-sov-watch-state="google"]').innerText()))
    await page.locator('[data-sov-section="advanced"] > summary').click(); await page.waitForTimeout(300)
    check(`${name}: Advanced opened shows export, be forgotten, erasure`, (await page.locator('[data-sov-export]').count()) === 1 && (await page.locator('[data-sov-forget]').count()) === 1 && (await page.locator('[data-sov-erase="google"]').count()) === 1)
    await page.locator('[data-sov-section="advanced"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/${name}-advanced.png` })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
