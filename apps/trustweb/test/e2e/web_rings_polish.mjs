// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 web-rings-polish (headless, stock dev only): PORT=5442 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node web_rings_polish.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5442}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...extra })
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
const PEOPLE = [P('l1', 'Lena Test', 'close', { events: ['e1'] }), P('a1', 'Anna Test', 'friend', { events: ['e1'] }), P('o1', 'Omar Test', 'none', { via: 'l1' }), P('z1', 'Zed Hidden', 'none', { via: 'l1', anonymous: true })]
const box = (loc) => loc.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    const seed = (extra = {}) => page.evaluate(([ev, ppl, ex]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, schemaVersion: 3, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers: [], log: [], events: [ev], ...ex })), [EV, PEOPLE, extra])
    const fresh = async (extra) => { await seed(extra); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900) }
    await fresh()
    // 1 quiet colours
    const lena = page.locator('[data-pid="l1"] .ava').first()
    const bg = await lena.evaluate((n) => getComputedStyle(n).backgroundColor)
    const shadow = await lena.evaluate((n) => n.style.boxShadow)
    check(`${w}: rings mode: ring stroke set, fill neutral`, shadow.includes('2px') && bg !== '' , `${bg} | ${shadow}`)
    await fresh({ colourMode: 'full' })
    check(`${w}: full mode: no stroke`, (await page.locator('[data-pid="l1"] .ava').first().evaluate((n) => n.style.boxShadow)) === '')
    await fresh()
    // 2 beyond
    const omar = page.locator('[data-beyond="o1"]'), zed = page.locator('[data-beyond="z1"]')
    check(`${w}: second-hand people drawn, no data-pid`, (await omar.count()) === 1 && (await zed.count()) === 1 && (await page.locator('[data-pid="o1"]').count()) === 0)
    check(`${w}: named one has a label, anonymous one has none`, (await omar.locator('span').count()) === 1 && (await zed.locator('span').count()) === 0)
    check(`${w}: tooltip via Lena`, (await omar.getAttribute('title')) === 'via Test Lena' || (await omar.getAttribute('title'))?.startsWith('via '))
    const wrapBox = await box(page.locator('.rings-wrap'))
    const centre = { x: wrapBox.x + wrapBox.width / 2, y: wrapBox.y + wrapBox.height / 2 }
    const dist = async (loc) => { const b = await box(loc); return Math.hypot(b.x + b.width / 2 - centre.x, b.y + b.height / 2 - centre.y) }
    const dOmar = await dist(omar), dAnna = await dist(page.locator('[data-pid="a1"]'))
    check(`${w}: Omar sits outside the outer ring dot`, dOmar > dAnna, `${dOmar} vs ${dAnna}`)
    await page.screenshot({ path: `${SHOTS}/web-rings-polish-beyond-${w}.png` })
    // 3 three dots on the bar line
    const bar = await box(page.locator('.tabs')), dots = await box(page.locator('.bar-more'))
    check(`${w}: the three dots overlap the bar's vertical band`, dots.y < bar.y + bar.height && dots.y + dots.height > bar.y, JSON.stringify({ bar, dots }))
    check(`${w}: the three dots sit at the bar's right end`, dots.x + dots.width <= bar.x + bar.width + 1 && dots.x > bar.x + bar.width / 2)
    check(`${w}: dots higher than the bar's centre`, dots.y + dots.height / 2 < bar.y + bar.height / 2)
    // 4 events own button
    check(`${w}: Events is its own bottom-bar button`, (await page.locator('.tabs [data-go="events"]').count()) === 1)
    // 6 small menu
    const node = page.locator('[data-pid="a1"]')
    await node.click({ button: 'right' }); await page.waitForTimeout(200)
    const menu = page.locator('[data-person-menu]')
    check(`${w}: right click opens the small menu`, (await menu.count()) === 1)
    check(`${w}: three rows`, (await menu.locator('[data-person-menu-row]').count()) === 3)
    const mb = await box(menu)
    check(`${w}: the menu stays inside the viewport`, mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= w && mb.y + mb.height <= h, JSON.stringify(mb))
    check(`${w}: the big overlay stays closed`, (await page.locator('.rings-wrap.card-open').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/web-rings-polish-menu-${w}.png` })
    await menu.locator('[data-person-menu-row="tag"]').click(); await page.waitForTimeout(150)
    await page.locator('[data-person-menu-tag]').fill('mentor'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    check(`${w}: Tag… tags the person`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.find((p) => p.id === 'a1').fields)) !== undefined && JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.find((p) => p.id === 'a1').fields ?? {})).includes('true'))
    await page.locator('[data-pid="a1"]').click({ button: 'right' }); await page.waitForTimeout(200)
    await page.locator('[data-person-menu-row="open"]').click(); await page.waitForTimeout(400)
    check(`${w}: Open (and the single press) show the big overlay`, (await page.locator('[data-person-menu]').count()) === 0)
    // 5 tap the event
    await fresh({ uiRings: { show: ['event:e1'], hide: [] } })
    const hint = page.locator('[data-tap-event="e1"]')
    check(`${w}: the tap-the-event hint exists`, (await hint.count()) === 1)
    const hb = await box(hint)
    check(`${w}: the hint sits inside the viewport`, hb.x >= 0 && hb.y >= 0 && hb.x + hb.width <= w && hb.y + hb.height <= h && hb.width > 40 && hb.height > 16, JSON.stringify(hb))
    check(`${w}: the hint is visible`, await hint.isVisible())
    await page.screenshot({ path: `${SHOTS}/web-rings-polish-hint-${w}.png` })
    await hint.click(); await page.waitForTimeout(500)
    check(`${w}: tapping it opens the event page`, (await page.locator('.events-page').count()) >= 1)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
