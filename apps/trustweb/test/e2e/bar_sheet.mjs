// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 35 bar-sheet-2 (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path to playwright-core index.mjs> node bar_sheet.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
try {
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [], feed: { on: true } })), KEY)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    const bar = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).uiBar, KEY)
    const tap = (sel) => page.locator(sel).first().click()

    check(`${w}: five buttons (Web, Chat, Feed, Events, Resources), only the centre Feed raised (wave 42 D2)`, (await page.locator('.tabs .tab-primary, .tabs .tab-record').count()) === 1 && (await page.locator('.tabs .tab-primary[data-go="feed"]').count()) === 1 && (await page.locator('.tabs > .tab, .tabs > button.tab-record').count()) === 5)
    await tap('[data-bar-more]'); await page.waitForTimeout(300)
    check(`${w}: ⋮ lists Record as a direct button, Community is not in the bar`, (await page.locator('.sheet.on [data-bar-view="record"]').count()) === 1 && (await page.locator('.tabs [data-go="mod:community"]').count()) === 0)
    check(`${w}: ⋮ does not offer People or Map`, (await page.locator('.sheet.on [data-bar-view="people"], .sheet.on [data-bar-view="map"]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/bar-sheet-2-more-${w}.png` })
    await tap('[data-bar-open-settings]'); await page.waitForTimeout(300)
    check(`${w}: no square checkbox drawn`, (await page.locator('.sheet.on .bar-opt-row input').evaluateAll((ns) => ns.length > 0 && ns.every((n) => getComputedStyle(n).opacity === '0'))))
    check(`${w}: Record bubble starts empty`, !(await page.locator('[data-bar-opt="record"]').evaluate((n) => n.classList.contains('on'))))
    await tap('[data-bar-opt="record"]'); await page.waitForTimeout(300)
    check(`${w}: tapping the bubble fills it and adds Record`, await page.locator('[data-bar-opt="record"]').evaluate((n) => n.classList.contains('on')) && (await bar()).order.includes('record') && !(await bar()).hidden.includes('record'))
    check(`${w}: six buttons -> the middle two raised`, (await page.locator('.tabs .tab-primary, .tabs .tab-record').count()) === 2)
    await page.locator('[data-bar-halo="chat"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/bar-sheet-2-sheet-${w}.png` })
    await tap('[data-bar-opt="record"]'); await page.waitForTimeout(300)
    check(`${w}: Record off again -> five buttons, Feed raised`, (await page.locator('.tabs .tab-primary[data-go="feed"]').count()) === 1 && (await page.locator('.tabs .tab-primary, .tabs .tab-record').count()) === 1)
    await tap('[data-bar-halo="chat"]'); await page.waitForTimeout(300)
    check(`${w}: a halo rings Chat in the row (wave 40, replaces the Highlight section)`, (await page.locator('.tabs .tab-halo[data-go="chat"]').count()) === 1 && (await bar()).halo?.join() === 'chat')
    await tap('[data-bar-halo="chat"]'); await page.waitForTimeout(300)
    check(`${w}: pressing it again takes the halo off`, (await page.locator('.tabs .tab-halo').count()) === 0)
    await page.evaluate(() => document.querySelector('.tabs').scrollIntoView())
    await page.screenshot({ path: `${SHOTS}/bar-sheet-2-bar-${w}.png` })
    check(`${w}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${w}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
