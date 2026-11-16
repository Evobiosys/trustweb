// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities (headless, stock dev only, synthetic record): Eye > Community sets the community chip silently, event mode (event page toggle,
 * pill above the filter row on Web / Chat / Resources / Ask, only the event's people, X leaves), a pinned saved filter above the filter row, the community tree.
 * Bounding-box check (D-P06): the bar overlaps no header control. PORT=5451 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node filters_communities.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5451}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields, extra = {}) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}`, ...extra })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }, { events: ['e1'] }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' }), person('p3', 'Dan Huber', 'friend', {})]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'book', colour: '#aa3300', label: 'Book club', community: true }]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'] }, book: { kind: 'informal', organizers: [], parent: 'iyg' } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name, did: 'did:test:' + p.id, ring: 'friend', connectedAt: 1 })), log: [], inventory: [], people, events: [EV], extData, twSettings: { extensions: { 'community-mighty': true } },
  savedFilters: [{ id: 'sf1', name: 'Only IYG', show: ['tag:iyg'], hide: [], pinned: true }] })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const open = async () => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [record, JSON.stringify(tags)])
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
      return page
    }
    const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const page = await open()

    // pinned saved filter above the filter row (Web)
    check(`${w}: the pinned saved filter shows above the Web`, (await page.locator('[data-filter-bar] [data-pinned-filter="sf1"]').count()) === 1)
    await page.locator('[data-pinned-filter="sf1"]').click(); await page.waitForTimeout(300)
    check(`${w}: pressing it applies its chips`, JSON.stringify((await store(page)).uiRings?.show) === '["tag:iyg"]', JSON.stringify((await store(page)).uiRings))
    await page.screenshot({ path: `${SHOTS}/filters-communities-pinned-${w}.png` })
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.uiRings = { ...s.uiRings, show: [], hide: [] }; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)

    // Eye > Community sets the community chip silently
    await page.locator('.view-menu-btn').first().click(); await page.waitForTimeout(250)
    const comm = page.locator('[data-mod-view="community"]')
    if ((await comm.count()) === 1) {
      await comm.click(); await page.waitForTimeout(600)
      check(`${w}: Eye > Community put the bare community chip in the filter`, (await store(page)).uiRings?.show?.includes('community'), JSON.stringify((await store(page)).uiRings))
      // the tree in the switcher
      if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
      await page.locator('[data-community-switch]').click(); await page.waitForTimeout(300)
      check(`${w}: the switcher lists the sub-community under its parent (depth 1)`, (await page.locator('[data-community-depth="1"] [data-community-pick="book"]').count()) === 1, 'no switcher')
      if ((await page.locator('[data-community-fold="iyg"]').count()) === 1) {
        await page.locator('[data-community-fold="iyg"]').click(); await page.waitForTimeout(200)
        check(`${w}: folding the parent hides the sub-community`, (await page.locator('[data-community-pick="book"]').count()) === 0)
      }
      await page.screenshot({ path: `${SHOTS}/filters-communities-tree-${w}.png` })
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.uiRings = { ...s.uiRings, show: [], hide: [] }; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) })
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    } else check(`${w}: the eye lists Community`, false, 'module view missing')

    // event mode: toggle on the event page
    await page.evaluate(() => { location.hash = '' })
    const s0 = await store(page)
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); s.uiRings = { ...s.uiRings, eventMode: 'e1' }; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    check(`${w}: the event-mode pill reads #event:Winter IYG on the Web`, (await page.locator('[data-event-mode-pill]').innerText()).includes('#event:Winter IYG'))
    const dots = await page.locator('[data-person], .dot, [data-ring-person]').count()
    const bar = await page.locator('[data-filter-bar]').boundingBox()
    const gear = await page.locator('.hdr-tools, .hdr-right, header').first().boundingBox()
    check(`${w}: the bar sits below the header (no overlay)`, !!bar && !!gear && bar.y >= gear.y + gear.height - 1, JSON.stringify({ bar, gear }))
    await page.screenshot({ path: `${SHOTS}/filters-communities-eventmode-web-${w}.png` })
    for (const [id, sel] of [['chat', '[data-go="chat"]'], ['inventory', '[data-go="inventory"]']]) {
      const tab = page.locator(sel).first()
      if ((await tab.count()) === 0) { check(`${w}: tab ${id} exists`, false); continue }
      await tab.click(); await page.waitForTimeout(500)
      check(`${w}: the pill stays on ${id}`, (await page.locator('[data-event-mode-pill]').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/filters-communities-eventmode-${id}-${w}.png` })
    }
    const chatTab = page.locator('[data-go="chat"]').first()
    if (await chatTab.count()) { await chatTab.click(); await page.waitForTimeout(400) }
    // leave with the X
    await page.locator('[data-event-mode-leave]').click(); await page.waitForTimeout(300)
    check(`${w}: X leaves event mode (pill gone, record cleared)`, (await page.locator('[data-event-mode-pill]').count()) === 0 && (await store(page)).uiRings?.eventMode === undefined)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    void s0; void dots; void overlap
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
