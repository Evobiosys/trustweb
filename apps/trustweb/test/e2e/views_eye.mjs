// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 views-eye proof (headless, dev only): PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node views_eye.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000 }] })
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
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    const tap = (sel) => (name === 'phone' ? page.locator(sel).tap() : page.locator(sel).click())
    check(`${name}: eye replaces the dots`, (await page.locator('.hdr-right .view-menu-btn').count()) === 1 && (await page.locator('.web-view-row [aria-label="Choose a view"]').count()) === 0)
    await tap('.view-menu-btn'); await page.waitForTimeout(300)
    const order = await page.locator('[data-view-drop] .view-opt').evaluateAll((bs) => bs.map((b) => b.dataset.view))
    check(`${name}: menu order`, JSON.stringify(order) === JSON.stringify(['rings', 'network', 'people', 'dex', 'compact']))
    check(`${name}: Other views divider`, (await page.locator('.view-drop-sep').innerText()).toLowerCase().includes('other views'))
    await page.screenshot({ path: `${SHOTS}/${name}-eye-menu.png` })
    await tap('[data-view-drop] [data-view="network"]'); await page.waitForTimeout(600)
    check(`${name}: legend folded at first`, !(await page.locator('[data-net-legend]').isVisible()))
    await tap('[data-net-legend-btn]')
    check(`${name}: legend under (i)`, (await page.locator('[data-net-legend]').isVisible()))
    await tap('[data-net-legend-btn]')
    check(`${name}: legend hides again`, !(await page.locator('[data-net-legend]').isVisible()))
    await tap('.view-menu-btn'); await tap('[data-view-drop] [data-view="dex"]'); await page.waitForTimeout(1500)
    check(`${name}: Dex opens as a page, no sheet`, (await page.locator('.curator-page').count()) === 1 && (await page.locator('.sheet.on').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/${name}-dex-page.png` })
    await page.goBack(); await page.waitForTimeout(400)
    check(`${name}: Back returns to the web`, (await page.locator('.curator-page').count()) === 0 && (await page.locator('.web-view-row').count()) === 1)
    await tap('.view-menu-btn'); await tap('[data-view-drop] [data-view="compact"]'); await page.waitForTimeout(1500)
    check(`${name}: Contacts compact opens as a page`, (await page.locator('.curator-page').count()) === 1)
    await page.goBack(); await page.waitForTimeout(400)
    await tap('.web-search-btn'); await page.waitForTimeout(200)
    check(`${name}: magnifier expands the search, focused`, (await page.locator('[data-web-search]').count()) === 1 && (await page.evaluate(() => document.activeElement?.hasAttribute('data-web-search'))))
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    check(`${name}: Escape collapses it`, (await page.locator('[data-web-search]').count()) === 0)
    await tap('.web-search-btn'); await page.locator('[data-web-search]').fill('Ben'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    check(`${name}: Enter opens People with the query`, (await page.locator('[data-people-search]').inputValue()) === 'Ben')
    await page.goBack(); await page.waitForTimeout(400)
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.uiPins = { views: ['network', 'dex'] }; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) })
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    check(`${name}: pinned views show as glyph buttons`, JSON.stringify(await page.locator('[data-view-pin]').evaluateAll((bs) => bs.map((b) => b.dataset.viewPin))) === JSON.stringify(['network', 'dex']))
    await page.screenshot({ path: `${SHOTS}/${name}-pinned.png` })
    await tap('[data-view-pin="network"]'); await page.waitForTimeout(500)
    check(`${name}: a pinned glyph switches the view`, (await page.locator('[data-view="network"].net').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
