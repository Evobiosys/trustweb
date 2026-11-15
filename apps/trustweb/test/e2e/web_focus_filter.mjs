// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 web-focus-filter (headless, stock dev only): PORT=5433 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node web_focus_filter.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5433}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const P = (id, name, ring, events = []) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...(events.length ? { events } : {}) })
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, roles: [{ name: 'Cook', who: 'd1' }] }
const PEOPLE = [P('a1', 'Anna Huber', 'friend', ['e1']), P('b1', 'Ben Gruber', 'close', ['e1']), P('c1', 'Clara Moser', 'friend'), P('d1', 'Dora Keller', 'acquaintance'), P('e1p', 'Emil Rainer', 'close')]
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ev, ppl]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers: [], log: [], events: [ev] })), [EV, PEOPLE])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const openEvent = async () => {
      await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
      await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    }
    await openEvent()
    check(`${w}: the web glyph sits in the people header`, (await page.locator('.ev-people-head [data-event-web-focus]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/web-focus-filter-event-${w}.png` })
    await page.locator('[data-event-web-focus]').click(); await page.waitForTimeout(600)
    check(`${w}: the Web tab is the active tab`, await page.locator('.tabs [data-go="web"].on').count() === 1, await page.locator('.tabs .on').evaluateAll((n) => n.map((x) => x.getAttribute('data-go'))))
    check(`${w}: the filter is the one event chip`, JSON.stringify((await store()).uiRings?.show) === '["event:e1"]')
    const badge = page.locator('[data-filter-badge]')
    check(`${w}: the badge shows 1`, (await badge.count()) === 1 && (await badge.innerText()).trim() === '1')
    const names = await page.locator('.web-view, main, #app').first().innerText()
    check(`${w}: the event's people show, the others do not`, ['Anna', 'Ben', 'Dora'].every((n) => names.includes(n)) && !names.includes('Clara') && !names.includes('Emil'), names.slice(0, 200))
    // P06: nothing overlays the badge
    const boxes = await page.locator('.zone-switch > *').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    check(`${w}: badge and the two side buttons do not overlap`, boxes.length >= 3 && boxes.every((a, i) => boxes.every((b, j) => i === j || !hit(a, b))))
    await page.screenshot({ path: `${SHOTS}/web-focus-filter-web-${w}.png` })
    // press: the filter list with the removable chip
    await badge.click(); await page.waitForTimeout(400)
    const row = page.locator('[data-filter-active="event:e1"]')
    check(`${w}: press opens the filter list with "#event:Winter IYG"`, (await row.count()) === 1 && (await row.innerText()).includes('#event:Winter IYG'))
    await page.screenshot({ path: `${SHOTS}/web-focus-filter-list-${w}.png` })
    // Back from the Web returns to the event page
    if (w < 600) { await page.keyboard.press('Escape'); await page.locator('.veil.on').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {}); await page.waitForTimeout(300) }
    await page.goBack(); await page.waitForTimeout(500)
    check(`${w}: Back returns to the event's page`, (await page.locator('[data-event-web-focus]').count()) === 1)
    // remove the chip from the list, then clear all by right click
    await page.locator('[data-event-web-focus]').click(); await page.waitForTimeout(500)
    await page.locator('[data-filter-badge]').dispatchEvent('contextmenu'); await page.waitForTimeout(400)
    check(`${w}: right click clears every filter, the badge is gone`, (await page.locator('[data-filter-badge]').count()) === 0 && (await store()).uiRings.show.length === 0)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
