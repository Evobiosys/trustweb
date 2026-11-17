// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave44 home-dashboard (headless, stock dev server, synthetic record): PORT=5445 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<index.mjs> node home_dashboard.mjs
 *  A. Home = tile board: Web centre, asks to me left, asks I sent right; no overlap, no document scroll (360x780 and 1280x900).
 *  B. Drag a tile to another column: stored as homeLayout, survives a reload; Settings > Home "Reset layout" restores the default.
 *  C. Dashboard: reachable from Home; "Live now" flashes once on open, then stays static; Refresh replays it once.
 *  D. Managed or unmanaged shows only inside the Dashboard's Settings, never on the card.
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5445}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const record = () => ({
  v: 1, me: { id: 'me1', displayName: 'Tester Person' }, peers: [], log: [], inventory: [], missedPopupOff: true, uiViews: { webDefault: 'home' },
  events: [{ id: 'e1', name: 'Winter Gathering', from: '2020-01-01', where: 'Vienna', attended: true, createdAt: 1 }],
  people: [{ id: 'p1', name: 'Ana Muster', ring: 'close', lines: [], context: '', peerId: 'x1', fields: { iyg: 'true' } }, { id: 'p2', name: 'Ben Beispiel', ring: 'friend', lines: [], context: '', fields: { iyg: 'true' } }],
  awayAsks: [{ id: 'q1', at: Date.now(), peerId: 'x1', from: 'Ana Muster', text: 'Does anyone own a ladder?' }],
  sentAsks: [{ id: 's1', text: 'Who can lend a drill?', at: Date.now(), to: [] }],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } },
})
const tags = [{ id: 'iyg', colour: '#2e7d32', label: 'IYG', community: true }]
const overlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).homeLayout ?? null)
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: false })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)); localStorage.setItem('trustweb.v1.colourtags', JSON.stringify(t)) }, [record(), tags])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1000)

    // ---- A. the board
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
    check(`${w}: A. the Web tab opens the Home board`, (await page.locator('[data-home-board]').count()) === 1)
    const inCol = async (col) => page.locator(`[data-home-col="${col}"] [data-home-tile]`).evaluateAll((n) => n.map((x) => x.getAttribute('data-home-tile')))
    check(`${w}: A. Web in the centre`, JSON.stringify(await inCol('center')) === '["web"]')
    check(`${w}: A. others' requests left`, JSON.stringify(await inCol('left')) === '["asksToMe","connects","requests"]')   // wave44c: Existing requests at the bottom
    check(`${w}: A. my requests right`, JSON.stringify(await inCol('right')) === '["asksSent","invites"]')
    check(`${w}: A. the ask to me shows its text`, (await page.locator('[data-home-tile="asksToMe"]').innerText()).includes('ladder'))
    const boxes = await page.locator('[data-home-tile]').evaluateAll((n) => n.map((x) => { const b = x.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }))
    let clash = false
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clash = true
    check(`${w}: A. no tile overlaps another`, !clash)
    check(`${w}: A. no document scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
    await page.screenshot({ path: `${SHOTS}/home-dashboard-board-${w}.png` })

    // ---- B. drag asksSent to the left column (touch phones scroll; this is the pointer/mouse path)
    const from = await page.locator('[data-home-tile="asksSent"]').boundingBox()
    await page.locator('[data-home-tile="asksSent"]').scrollIntoViewIfNeeded()
    const src = await page.locator('[data-home-tile="asksSent"]').boundingBox()
    const dst = await page.locator('[data-home-tile="asksToMe"]').boundingBox()
    await page.mouse.move(src.x + 20, src.y + 14); await page.mouse.down()
    await page.mouse.move(src.x + 40, src.y + 30, { steps: 4 })
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height * 0.9, { steps: 10 })
    await page.mouse.up(); await page.waitForTimeout(400)
    void from
    const left = await inCol('left')
    check(`${w}: B. the dragged tile sits in the left column`, left.includes('asksSent'), JSON.stringify(left))
    check(`${w}: B. stored as homeLayout`, ((await stored(page))?.left ?? []).includes('asksSent'))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1000)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    check(`${w}: B. the layout survives a reload`, (await inCol('left')).includes('asksSent'))
    await page.locator('[data-bar-more]').first().click(); await page.waitForTimeout(300)
    check(`${w}: B. the ⋮ list has Dashboard and Home`, (await page.locator('[data-bar-dashboard]').count()) === 1 && (await page.locator('[data-bar-home]').count()) === 1)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    await page.evaluate(() => { localStorage.setItem('trustweb.ui.settings.advanced-all', '1'); localStorage.setItem('trustweb.ui.settings.home', '1') })
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-home-reset]').first().click(); await page.waitForTimeout(500)
    check(`${w}: B. Reset layout drops homeLayout`, (await stored(page)) === null)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // ---- C. Dashboard, live now
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
    await page.locator('[data-home-dashboard]').click(); await page.waitForTimeout(200)
    check(`${w}: C. the Dashboard opens from Home`, (await page.locator('[data-dashboard]').count()) === 1)
    const flash = () => page.locator('[data-dashboard-flash]').first().getAttribute('data-dashboard-flash')
    check(`${w}: C. live now flashes when the screen opens`, (await flash()) === 'on')
    await page.waitForTimeout(1800)
    check(`${w}: C. then stays static (class removed after the one run)`, (await flash()) === 'off' && !(await page.locator('.dash-dot.flash').count()))
    await page.locator('[data-dashboard-refresh]').click(); await page.waitForTimeout(100)
    check(`${w}: C. Refresh plays it again`, (await flash()) === 'on')
    await page.waitForTimeout(1800)
    check(`${w}: C. and it ends again`, (await flash()) === 'off')
    await page.locator('.hdr .back').first().click(); await page.waitForTimeout(400); check(`${w}: C. Back returns to Home`, (await page.locator('[data-home-board]').count()) === 1); await page.locator('[data-home-dashboard]').click(); await page.waitForTimeout(200)
    check(`${w}: C. opening it again flashes once more`, (await flash()) === 'on')
    await page.waitForTimeout(1800)
    const tilesTxt = await page.locator('[data-dashboard-tile="members"]').innerText()
    check(`${w}: C. members counted`, /2 members/.test(tilesTxt), tilesTxt)
    await page.screenshot({ path: `${SHOTS}/home-dashboard-dash-${w}.png` })

    // ---- D. managed or unmanaged: only in Settings of the Dashboard
    const card = await page.locator('[data-dashboard]').innerText()
    const settings = await page.locator('[data-dashboard-settings]').innerText()
    const outside = card.replace(settings, '')
    check(`${w}: D. no Managed/Informal on the card`, !/managed|informal/i.test(outside), outside)
    await page.locator('[data-dashboard-settings] summary').click()
    await page.locator('[data-dashboard-kind]').selectOption('managed'); await page.waitForTimeout(400)
    check(`${w}: D. the kind is set under Settings`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).extData['community-mighty'].meta.iyg.kind)) === 'managed')
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
