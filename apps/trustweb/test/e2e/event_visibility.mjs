// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-event-visibility proof (headless, stock dev server): PORT=5301 SHOTS=<dir> PW=<playwright-core index.js> EXE=<chromium> node event_visibility.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5301}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], peerId: `peer-${id}`, ...extra })
const people = [P('a', 'Ada Lovelace', 'friend', { events: ['e1'], eventShow: { e1: 'discoverable' }, fields: { iyg: 'true' } }), P('b', 'Ben Gruber', 'close', { events: ['e1'], fields: { iyg: 'true' } }), P('c', 'Cleo Maier', 'friend', { events: ['e1'], eventShow: { e1: 'off' } })]
const EV = { id: 'e1', name: 'Winter IYG', from: day(3), where: 'Vienna', createdAt: 1, attended: true, hosts: ['Jakob'], communityId: 'iyg' }
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: [EV] }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t) }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)

    // 1: the attendee list respects what people announced
    check(`${tag}: open list shows Ben (tagged by me) but not Ada (discoverable) or Cleo (off)`, (await page.locator('[data-attendee]').evaluateAll((n) => n.map((x) => x.dataset.attendee).join())) === 'b')
    await page.locator('[data-event-tag-search]').fill('Ada'); await page.waitForTimeout(250)
    check(`${tag}: searching finds the discoverable Ada`, (await page.locator('[data-tag-person="a"]').count()) === 1)
    await page.locator('[data-event-tag-search]').fill('Cleo'); await page.waitForTimeout(250)
    check(`${tag}: searching never finds Cleo (off)`, (await page.locator('[data-tag-person="c"]').count()) === 0)
    await page.locator('[data-event-tag-search]').fill('')

    // 1: my own mode in Advanced
    await page.locator('[data-event-advanced] summary').click(); await page.waitForTimeout(250)
    check(`${tag}: my mode defaults to discoverable`, (await page.locator('[data-event-visibility]').getAttribute('data-event-visibility')) === 'discoverable')
    await page.locator('[data-event-visibility-opt="open"]').click(); await page.waitForTimeout(250)
    check(`${tag}: choosing "Show me to everyone" is stored per event`, (await rec(page)).events[0].showMe === 'open')
    await page.locator('[data-event-visibility-opt="discoverable"]').click(); await page.waitForTimeout(250)
    check(`${tag}: back to the default stores nothing`, !('showMe' in (await rec(page)).events[0]))

    // 2/3: share with the whole community; it is announced once
    check(`${tag}: host sees the share switch, off`, (await page.locator('[data-event-share-community]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-event-share-community]').click(); await page.waitForTimeout(400)
    const e1 = (await rec(page)).events[0]
    check(`${tag}: share on: stored, and announced once (stamp)`, e1.shareCommunity === true && typeof e1.announcedAt === 'number')
    await page.screenshot({ path: `${SHOTS}/steer-event-visibility-advanced-${tag}.png` })

    // 5: strike-through default off, Variations switch
    const decoration = () => page.locator('[data-event-share-community]').evaluate((n) => getComputedStyle(n).textDecorationLine)
    await page.locator('[data-event-share-community]').click(); await page.waitForTimeout(300)
    check(`${tag}: an OFF toggle is dimmed, not struck through, by default`, (await page.locator('[data-event-share-community]').getAttribute('aria-pressed')) === 'false' && !(await decoration()).includes('line-through') && (await page.locator('[data-event-share-community]').evaluate((n) => Number(getComputedStyle(n).opacity))) < 1)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    if (!(await page.locator('[data-variation-strike]').isVisible())) { await page.locator('details.settings-advanced-all > summary').first().click(); await page.waitForTimeout(300); if (!(await page.locator('[data-variation-strike]').isVisible())) { await page.locator('[data-settings-group="variations"] summary').first().click(); await page.waitForTimeout(300) } }
    const sw = page.locator('[data-variation-strike]')
    await sw.scrollIntoViewIfNeeded()
    check(`${tag}: Variations has the switch, off`, (await sw.getAttribute('aria-pressed')) === 'false')
    await sw.click(); await page.waitForTimeout(500)
    check(`${tag}: switch on stored and class set`, (await rec(page)).strikeSwitchedOff === true && await page.evaluate(() => document.documentElement.classList.contains('tw-strike')))
    await page.screenshot({ path: `${SHOTS}/steer-event-visibility-variations-${tag}.png` })
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check(`${tag}: with the switch on the OFF toggle is struck through`, (await decoration()).includes('line-through'))
    check(`${tag}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${tag}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await page.context().close()
  }
  // 4: community calendar
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    const rec2 = { ...record, events: [{ ...EV, from: day(0) }, { ...EV, id: 'e2', name: 'Other group event', communityId: 'garden', from: day(0) }] }
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t) }, [JSON.stringify(rec2), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('details.settings-advanced-all > summary').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"]')
    await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-ext-module="community-mighty"]').click(); await page.waitForTimeout(1200)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(400)
    await page.locator('.sheet.on [data-bar-view="mod:community"]').click(); await page.waitForTimeout(900)
    if (await page.locator('[data-community-menu]').isVisible()) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    check(`${tag}: the community menu has Calendar right under Events`, (await page.locator('[data-community-nav]').evaluateAll((n) => n.map((x) => x.dataset.communityNav))).join().includes('events,calendar'))
    await page.locator('[data-community-nav="calendar"]').click(); await page.waitForTimeout(500)
    check(`${tag}: calendar grid shows; today lists the community's event only`, (await page.locator('[data-community-calendar] .cal-grid').count()) === 1 && (await page.locator('[data-community-cal-event]').evaluateAll((n) => n.map((x) => x.dataset.communityCalEvent).join())) === 'e1')
    await page.screenshot({ path: `${SHOTS}/steer-event-visibility-calendar-${tag}.png` })
    await page.locator('[data-community-cal-event="e1"]').click(); await page.waitForTimeout(500)
    check(`${tag}: a tap opens the event`, (await page.locator('[data-event-tag-chip]').count()) === 1)
    check(`${tag}: no page errors (calendar)`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
