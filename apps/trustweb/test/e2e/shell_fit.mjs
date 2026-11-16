// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 shell-fit (headless, stock dev only): PORT=5535 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node shell_fit.mjs. Mobile 360x780: the document never scrolls, the ⋮ sheet lists every view above the bar, the event pill is one thin line. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5535}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const today = new Date().toISOString().slice(0, 10)
const people = Array.from({ length: 24 }, (_, i) => ({ id: 'p' + i, name: 'Person ' + i, context: '', ring: ['close', 'friend', 'acquaintance'][i % 3], metAt: 1, lines: [], events: i < 5 ? ['e1'] : [] }))
const EVENT = { id: 'e1', name: 'Winter IYG', from: today, where: 'Graz', createdAt: 1, attended: true, people: ['p1'] }
try {
  for (const [w, h, label] of [[360, 780, 'm360'], [412, 640, 'm412short']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([p, ev]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: p, events: [ev], atEvent: { eventId: ev.id, since: Date.now() - 3600e3 } })), [people, EVENT])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200)
    const fits = () => page.evaluate(() => document.documentElement.scrollHeight === document.documentElement.clientHeight && document.body.scrollHeight === document.body.clientHeight)
    const dismiss = async () => { for (const sel of ['.twf-x', '.twf-close']) if (await page.locator(sel).count()) await page.locator(sel).first().click().catch(() => {}) }
    await dismiss()
    // the pill
    const pill = page.locator('[data-at-event-frame]')
    const box = await pill.boundingBox()
    check(`${label}: pill is one thin line (<= 28 px)`, !!box && box.height <= 28, JSON.stringify(box))
    check(`${label}: pill spans the width minus margins`, !!box && box.width >= w - 24 && box.x >= 0 && box.x + box.width <= w, JSON.stringify(box))
    check(`${label}: no latch, no extra buttons in the pill`, (await page.locator('.ae-latch, [data-at-event-latch], .at-event-frame [data-at-event-leave], .at-event-frame [data-at-event-bell]').count()) === 0)
    check(`${label}: pill text = event tag #event:<name>`, ((await pill.innerText()).replace(/\s+/g, ' ').trim()) === '#event:Winter IYG', await pill.innerText())
    for (const [name, go] of [['Web', 'web'], ['Events', 'events'], ['Resources', 'inventory'], ['Chat', 'chat']]) {
      await page.locator(`[data-go="${go}"]`).first().click(); await page.waitForTimeout(500)
      check(`${label}: document does not scroll on ${name}`, await fits())
      if (go === 'web' && label === 'm360') check(`${label}: the Web view needs no scrolling at all (the rings fit)`, await page.evaluate(() => [...document.querySelectorAll('.screen .scroll')].every((e) => e.scrollHeight <= e.clientHeight + 1)))
      if (label === 'm360') await page.screenshot({ path: `${SHOTS}/shell-fit-${label}-${name}.png` })
    }
    // settings
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(600)
    check(`${label}: document does not scroll in Settings`, await fits())
    await page.locator('[data-sheet-home]').click(); await page.waitForTimeout(500)
    // press = event page; long press / right click = edit form
    await pill.locator('button').click(); await page.waitForTimeout(500)
    check(`${label}: a press opens the event page`, (await page.locator('[data-event-edit]').count()) === 1 && (await page.locator('[data-event-save]').count()) === 0)
    check(`${label}: document does not scroll on the open event page`, await fits())
    if (label === 'm360') await page.screenshot({ path: `${SHOTS}/shell-fit-${label}-EventPage.png` })
    // review-fixes-43: one notifications control on the event page (the bell merged into Notifications)
    check(`${label}: the event page holds Leave, one Notifications control and who is here`, (await page.locator('[data-at-event-leave]').count()) === 1 && (await page.locator('[data-at-event-bell]').count()) === 0 && (await page.locator('[data-event-notify]').count()) === 1 && (await page.locator('[data-at-event-panel]').count()) === 1)
    await page.locator('[data-event-notify]').click(); await page.waitForTimeout(200)
    check(`${label}: Notifications off is struck through (aria-pressed=false + .tw-off)`, (await page.locator('[data-event-notify]').getAttribute('aria-pressed')) === 'false' && (await page.locator('[data-event-notify].tw-off').count()) === 1)
    await page.locator('[data-event-notify]').click(); await page.waitForTimeout(200)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    await page.locator('[data-at-event-name]').click({ button: 'right' }); await page.waitForTimeout(400)
    check(`${label}: right click opens the edit form`, (await page.locator('[data-event-save]').count()) === 1)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    const nb = await page.locator('[data-at-event-name]').boundingBox()
    await page.touchscreen.tap(nb.x + 20, nb.y + 10) // a tap first: it must open the page, not the form
    await page.waitForTimeout(400)
    check(`${label}: a tap opens the page, not the form`, (await page.locator('[data-event-edit]').count()) === 1)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    // ⋮ sheet
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(600)
    const ids = await page.locator('[data-bar-view]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bar-view')))
    for (const want of ['record', 'ask', 'network', 'people', 'map']) check(`${label}: ⋮ lists ${want}`, ids.includes(want), ids.join(','))
    const sheet = await page.locator('.sheet.on').boundingBox()
    const tabs = await page.locator('.tabs').boundingBox()
    check(`${label}: the sheet does not overlay the bottom bar`, !hit(sheet, tabs), JSON.stringify([sheet, tabs]))
    check(`${label}: the sheet stays on the screen`, sheet.y >= 0 && sheet.y + sheet.height <= h)
    const last = page.locator('[data-bar-open-settings]')
    await last.scrollIntoViewIfNeeded()
    const lb = await last.boundingBox()
    check(`${label}: the last entry scrolls into view above the bar`, lb.y + lb.height <= tabs.y + 1 && lb.y >= sheet.y, JSON.stringify([lb, tabs]))
    if (label === 'm360') await page.screenshot({ path: `${SHOTS}/shell-fit-${label}-dots.png` })
    check(`${label}: document does not scroll with the sheet open`, await fits())
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
