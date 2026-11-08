// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 renames proof (headless): PORT=5470 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node renames.mjs. Synthetic record. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5470}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const RINGS = ['closest', 'close', 'friend', 'acquaintance']
const people = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, ring: RINGS[i % 4], lines: [], context: '', metAt: Date.now() - i * 86_400_000, fields: {} }))
try {
  for (const [name, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people }))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    check(`${name}: no "All people as a table" button on Web`, (await page.locator('button[data-view="complete"]').count()) === 0)
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(300)
    const labels = await page.locator('[data-view-drop] .view-opt').allInnerTexts()
    check(`${name}: eye menu names Table and Simple list`, labels.some((t) => t.includes('Table')) && labels.some((t) => t.includes('Simple list')) && !labels.some((t) => /\bComplete\b|^People\b/.test(t.trim())))
    await page.screenshot({ path: `${SHOTS}/renames-eye-${name}.png` })
    await page.locator('[data-view-drop] [data-view="complete"]').click(); await page.waitForTimeout(500)
    check(`${name}: eye > Table opens the table`, (await page.locator('[data-complete-view]').count()) === 1)
    await page.goBack().catch(() => {}); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    // a card open, then Web in the bottom bar
    await page.evaluate(() => localStorage.setItem('trustweb.ui.webView', 'rings'))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('.rings-wrap .node[data-pid="p0"]').last().click({ force: true }); await page.waitForTimeout(700)
    const cardOpen = await page.locator('.rings-wrap').count() === 0
    await page.screenshot({ path: `${SHOTS}/renames-card-${name}.png` })
    await page.locator('button.tab[data-go="web"]').click(); await page.waitForTimeout(600)
    check(`${name}: Web from a card shows the rings `, cardOpen && (await page.locator('.rings-wrap').count()) >= 1)
    // the leaving notice: appears after hidden -> visible, once, dismissible
    check(`${name}: no notice at first`, (await page.locator('[data-browser-only-notice]').count()) === 0)
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForTimeout(600)
    check(`${name}: notice after returning`, (await page.locator('[data-browser-only-notice]').count()) === 1)
    check(`${name}: link to TrustInTheWeb.com, underlined`, (await page.locator('[data-browser-only-notice] a[href="https://trustintheweb.com/"]').evaluate((a) => getComputedStyle(a).textDecorationLine)) === 'underline')
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${SHOTS}/renames-notice-${name}.png` })
    await page.locator('[data-browser-only-dismiss]').click(); await page.waitForTimeout(400)
    check(`${name}: dismissed, gone`, (await page.locator('[data-browser-only-notice]').count()) === 0)
    await page.reload(); await page.waitForTimeout(900)
    check(`${name}: stays gone after reload`, (await page.locator('[data-browser-only-notice]').count()) === 0)
    // Settings search
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    const groups0 = await page.locator('[data-settings-group]:visible').count()
    await page.locator('[data-settings-search]').fill('BACKUP'); await page.waitForTimeout(300)
    const groups1 = await page.locator('[data-settings-group]:visible').count()
    check(`${name}: search narrows (${groups0} -> ${groups1})`, groups1 > 0 && groups1 <= groups0)
    await page.screenshot({ path: `${SHOTS}/renames-search-${name}.png` })
    await page.locator('[data-settings-search]').fill('zzzqqq'); await page.waitForTimeout(300)
    check(`${name}: nonsense hides all groups`, (await page.locator('[data-settings-group]:visible').count()) === 0)
    await page.locator('[data-settings-search]').fill(''); await page.waitForTimeout(300)
    check(`${name}: empty query restores`, (await page.locator('[data-settings-group]:visible').count()) === groups0)
    check(`${name}: no page errors`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
