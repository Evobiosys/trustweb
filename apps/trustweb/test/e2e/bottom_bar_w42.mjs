// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 bottom-bar (headless, stock dev only): PORT=5412 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node bottom_bar_w42.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5412}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: [] })), KEY)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    const raised = () => page.locator('.tabs .tab-primary, .tabs .tab-record').count()
    const tabs = () => page.locator('.tabs > .tab, .tabs > button.tab-record').count()
    const bar = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).uiBar, KEY)
    const tap = (sel) => page.locator(sel).first().click()

    const n0 = await tabs()
    const want = (n) => (n % 2 ? 1 : 2)
    const total = 5 // wave 42 D2: the stock row holds Web, Chat, Feed, Events, Resources at 360 and 1280; Record, Community and the module views wait in the ⋮ list
    const showing = (m) => Math.min(m, w < 600 ? 6 : m)
    check(`${w}: stock row is exactly five and Community is not among them`, n0 === 5 && (await page.locator('.tabs [data-go="mod:community"]').count()) === 0)
    // D2: the top-left heading pill switches Personal | Community: visible inside the viewport and not covered
    const pill = await page.locator('[data-mode-pill]').first().boundingBox()
    check(`${w}: the Personal | Community pill is visible in the viewport`, !!pill && pill.x >= 0 && pill.y >= 0 && pill.x + pill.width <= w && pill.y + pill.height <= h)
    const note = await page.locator('.demo-friends:not([hidden])').first().boundingBox().catch(() => null)
    check(`${w}: P06 the first-run notice does not cover the pill`, !note || !pill || !hit(note, pill))
    check(`${w}: the Community option is the topmost element at its centre (nothing overlays it)`, await page.evaluate(() => { const b = document.querySelector('[data-mode-pill] [data-mode="community"]'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b === e || b.contains(e) }))
    check(`${w}: ${n0} tabs, ${want(n0)} raised (odd: the centre only, even: the middle pair)`, (await raised()) === want(n0))
    await tap('[data-bar-more]'); await page.waitForTimeout(300)
    await tap('[data-bar-open-settings]'); await page.waitForTimeout(300)
    check(`${w}: Record has an off control like every other view`, (await page.locator('.sheet.on [data-bar-opt="record"] input').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/bottom-bar-picker-${w}.png` })
    // P06: no control of the picker row overlays another (bounding boxes do not intersect)
    const boxes = await page.locator('.sheet.on [data-bar-row="record"] > *').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    check(`${w}: Record row controls do not overlap`, boxes.every((a, i) => boxes.every((b, j) => i === j || !hit(a, b))))
    await page.locator('.sheet.on [data-bar-opt="record"]').first().click(); await page.waitForTimeout(300)
    check(`${w}: Record on is stored and the bar gains a tab (six: the middle pair raised)`, !(await bar()).hidden.includes('record') && (await tabs()) === showing(total + 1) && (await raised()) === 2)
    await page.locator('.sheet.on [data-bar-opt="record"]').first().click(); await page.waitForTimeout(300)
    check(`${w}: Record off is stored and the bar is the five again`, (await bar()).hidden.includes('record') && (await tabs()) === showing(total))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    check(`${w}: after reload ${showing(total)} tabs, raise re-centred`, (await tabs()) === showing(total) && (await raised()) === want(showing(total)))
    // bar vs picker: the tab bar stays below the sheet content area (no overlay of the bar on the list)
    await page.screenshot({ path: `${SHOTS}/bottom-bar-record-off-${w}.png` })
    await tap('[data-bar-more]'); await page.waitForTimeout(300)
    check(`${w}: a hidden Record is reachable from the ⋮ list`, (await page.locator('.sheet.on [data-bar-view="record"]').count()) === 1)
    await tap('[data-bar-open-settings]'); await page.waitForTimeout(300)
    const shown = await page.locator('.sheet.on [data-bar-row][data-bar-slot="row"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-bar-row')))
    for (const id of shown.slice(0, -1)) { await page.locator(`.sheet.on [data-bar-opt="${id}"]`).first().click(); await page.waitForTimeout(150) }
    const rest = await bar()
    check(`${w}: the last view is kept (one tab left)`, (await tabs()) === 1 && rest.hidden.includes('record'))
    await page.locator(`.sheet.on [data-bar-opt="${shown.at(-1)}"]`).first().click(); await page.waitForTimeout(300)
    check(`${w}: removing the last one is refused`, (await tabs()) === 1)
    await page.locator('.sheet.on [data-bar-opt="record"]').first().click(); await page.waitForTimeout(300)
    check(`${w}: Record on again`, (await tabs()) === 2)
    // D2: Community is reached from the pill (stock mode): the switch works and the Personal option brings the five back
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    await page.locator('[data-mode-pill] [data-mode="community"]').first().click(); await page.waitForTimeout(800)
    check(`${w}: the pill switches to Community (its own row)`, await page.evaluate(() => document.body.hasAttribute('data-community-mode')))
    await page.screenshot({ path: `${SHOTS}/review3-community-pill-${w}.png` })
    await page.locator('[data-mode-pill] [data-mode="personal"]').first().click(); await page.waitForTimeout(800)
    check(`${w}: Personal brings the bar back`, !(await page.evaluate(() => document.body.hasAttribute('data-community-mode'))) && (await tabs()) > 0)
    check(`${w}: no page errors`, errors.length === 0)
    await ctx.close()
  }
  // B08 settings search "zzz"
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: [] })), KEY)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    await tapSettings(page)
    await page.fill('[data-settings-search]', 'zzz'); await page.waitForTimeout(300)
    check(`${w}: settings search "zzz" says No match found`, (await page.locator('.sheet.on [data-no-match]').innerText()).includes('No match found'))
    await page.screenshot({ path: `${SHOTS}/bottom-bar-nomatch-${w}.png` })
    await page.fill('[data-settings-search]', ''); await page.waitForTimeout(200)
    check(`${w}: the line goes with the query`, (await page.locator('.sheet.on [data-no-match]').count()) === 0)
    await ctx.close()
  }
} finally { await browser.close() }
async function tapSettings(page) {
  await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(400)
}
process.exit(failed ? 1 : 0)
