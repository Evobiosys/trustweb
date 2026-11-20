// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 resources-notion-views (headless, stock dev only, synthetic record): Resources get Notion-style views. My resources: six view pills;
 * Table sorts by a header tap and scrolls sideways inside its own box on a phone; Board groups by tag or status; Gallery shows cards; the
 * choice survives a reload (AppState.resViews). Community filter mode: four pills, its own remembered view. 360x780 and 1280x900.
 * PORT=5487 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node resources_notion_views.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5487}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs')
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'garden', colour: '#aa3300', label: 'Garden' }]
const item = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1000, ...over })
const inventory = [
  item('i1', 'Mango seeds', { tagAudience: ['iyg'], createdAt: 1700000000000 }),
  item('i2', 'Apple guide', { sharedBy: 'p1', communityId: 'iyg', createdAt: 1700500000000, link: 'https://www.example.org/apple' }),
  item('i3', 'Zucchini notes', { tagAudience: ['garden'], createdAt: 1600000000000 }),
]
const people = [{ id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, fields: { iyg: 'true' }, peerId: 'peer-p1' }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory, people, events: [], extData, twSettings: { extensions: { 'community-mighty': true } } })
const hide = '.twf, .twf-ok, .twp { display: none !important }'

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const seed = async (page, extra = (s) => s) => {
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [JSON.stringify(extra(JSON.parse(record))), JSON.stringify(tags)])
    }
    const settle = async (page) => {
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      for (const t of ['Not now', 'No thanks']) await page.getByText(t).first().click({ timeout: 2500 }).catch(() => {})
    }
    const open = async (extra) => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
      await page.goto(URL); await page.waitForTimeout(900)
      await seed(page, extra); await settle(page)
      return page
    }
    const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const rowIds = (page) => page.locator('[data-nv-row]').evaluateAll((n) => n.map((x) => x.getAttribute('data-nv-row')))
    const noDocScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

    // My resources
    let page = await open()
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${w}: six view pills (List, Table, Board, Gallery, Outliner, By person)`, (await page.locator('[data-nv-switch="mine"] [data-nv-view]').count()) === 6)
    await page.locator('[data-nv-view="table"]').click(); await page.waitForTimeout(300)
    check(`${w}: Table shows five sortable columns`, (await page.locator('[data-nv-table] [data-nv-col]').count()) === 5)
    check(`${w}: Table has a row per resource`, (await page.locator('[data-nv-row]').count()) === 3)
    await page.locator('[data-nv-col="name"]').click(); await page.waitForTimeout(250)
    check(`${w}: Name sorts A-Z`, JSON.stringify(await rowIds(page)) === '["i2","i1","i3"]', JSON.stringify(await rowIds(page)))
    await page.locator('[data-nv-col="name"]').click(); await page.waitForTimeout(250)
    check(`${w}: a second tap sorts Z-A`, JSON.stringify(await rowIds(page)) === '["i3","i1","i2"]', JSON.stringify(await rowIds(page)))
    check(`${w}: Shared by and Scope cells`, (await page.locator('[data-nv-row="i2"] td').nth(2).textContent()) === 'Ben Gruber' && (await page.locator('[data-nv-row="i2"] td').nth(4).textContent()) === 'IYG')
    const tw = await page.locator('[data-nv-table]').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }))
    if (w < 600) check(`${w}: the table scrolls sideways inside its box`, tw.sw > tw.cw, JSON.stringify(tw))
    check(`${w}: no document scroll`, await noDocScroll(page))
    await page.screenshot({ path: `${SHOTS}/resources-notion-views-table-${w}.png` })
    const r1 = await rec(page)
    check(`${w}: view and sort stored per scope (mine)`, r1.resViews?.mine?.view === 'table' && r1.resViews.mine.views.table.sort.dir === 'desc', JSON.stringify(r1.resViews))
    await settle(page)
    await page.locator('[data-go="inventory"]').first().click().catch(() => {}); await page.waitForTimeout(500)
    check(`${w}: Table and its sort survive a reload`, (await page.locator('[data-nv-table]').count()) === 1 && JSON.stringify(await rowIds(page)) === '["i3","i1","i2"]')

    await page.locator('[data-nv-view="board"]').click(); await page.waitForTimeout(300)
    const cols = await page.locator('[data-nv-column]').evaluateAll((n) => n.map((x) => x.getAttribute('data-nv-column')))
    check(`${w}: Board groups by tag (IYG, Garden)`, JSON.stringify(cols) === '["iyg","garden"]', JSON.stringify(cols))
    await page.locator('[data-nv-group="status"]').click(); await page.waitForTimeout(300)
    const cols2 = await page.locator('[data-nv-column]').evaluateAll((n) => n.map((x) => x.getAttribute('data-nv-column')))
    check(`${w}: Board by status (New, Mine)`, JSON.stringify(cols2) === '["new","mine"]', JSON.stringify(cols2))
    check(`${w}: no document scroll on the board`, await noDocScroll(page))
    await page.screenshot({ path: `${SHOTS}/resources-notion-views-board-${w}.png` })

    await page.locator('[data-nv-view="gallery"]').click(); await page.waitForTimeout(300)
    check(`${w}: Gallery has a card per resource`, (await page.locator('[data-nv-gallery] [data-nv-card]').count()) === 3)
    check(`${w}: a link card shows its host (no fetch)`, (await page.locator('[data-nv-card="i2"] [data-nv-host]').textContent()) === 'example.org')
    await page.screenshot({ path: `${SHOTS}/resources-notion-views-gallery-${w}.png` })
    await page.locator('[data-nv-card="i1"]').click(); await page.waitForTimeout(400)
    check(`${w}: a card opens its item`, (await page.locator('.sheet, [role="dialog"]').count()) >= 1)
    await page.close()

    // Community filter mode: own scope, own memory
    page = await open((s) => ({ ...s, uiRings: { show: ['tag:iyg'] }, resViews: { mine: { view: 'table' } } }))
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${w}: community scope: four pills, List by default`, (await page.locator('[data-nv-switch="community:iyg"] [data-nv-view]').count()) === 4 && (await page.locator('[data-nv-switch="community:iyg"] [data-nv-view="list"]').getAttribute('aria-pressed')) === 'true')
    await page.locator('[data-nv-view="board"]').click(); await page.waitForTimeout(300)
    check(`${w}: community Board lists only the community's resources`, (await page.locator('[data-nv-card]').count()) === 2 && (await page.locator('[data-nv-card="i3"]').count()) === 0)
    const r2 = await rec(page)
    check(`${w}: remembered per scope`, r2.resViews['community:iyg']?.view === 'board' && r2.resViews.mine.view === 'table', JSON.stringify(r2.resViews))
    await page.screenshot({ path: `${SHOTS}/resources-notion-views-community-${w}.png` })
    await page.close()
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
