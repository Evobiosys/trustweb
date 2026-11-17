// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 answers-43 (headless, stock dev only): clear filters + 5 s Undo (delta), community picker (epsilon), nickname and Mastodon fields in Advanced (zeta, iota). PORT=5439 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node answers_43.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5439}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const P = (id, name, ring, events = []) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...(events.length ? { events } : {}) })
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
const PEOPLE = [P('a1', 'Anna Huber', 'friend', ['e1']), P('b1', 'Ben Gruber', 'close', ['e1']), P('c1', 'Clara Moser', 'friend')]
const TAGS = [{ id: 'crew', colour: '#aa3300', label: 'IYG Crew', community: true }]
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ev, ppl, tags]) => {
      localStorage.setItem('trustweb.v1.colourtags', JSON.stringify(tags))
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester', nickname: 'Testy' }, people: ppl, peers: [], log: [], inventory: [], events: [ev] }))
    }, [EV, PEOPLE, TAGS])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const openEvent = async () => {
      await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
      await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    }
    // the add-event form carries the community choice, isolated by default
    await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-event-add]').click(); await page.waitForTimeout(300)
    check(`${w}: the add-event form has the community choice, isolated by default`, (await page.locator('[data-event-save]').count()) === 1 && (await page.locator('[data-event-community]').inputValue()) === '')
    await page.screenshot({ path: `${SHOTS}/answers-43-form-${w}.png` })
    await page.reload(); await page.waitForTimeout(800)
    await openEvent()

    // epsilon: the community choice sits in Advanced (and in the form); isolated by default
    await page.locator('[data-event-advanced] summary').click(); await page.waitForTimeout(200)
    const pick = page.locator('[data-event-advanced] [data-event-community]')
    check(`${w}: Advanced offers "Part of a community" with Isolated event first`, (await pick.count()) === 1 && (await pick.locator('option').first().innerText()).includes('Isolated'))
    check(`${w}: the picker lists the community`, (await pick.locator('option').allInnerTexts()).includes('IYG Crew'))
    await pick.selectOption('crew'); await page.waitForTimeout(300)
    check(`${w}: choosing it stores communityId`, (await store()).events[0].communityId === 'crew')
    await page.locator('[data-event-tag-search]').fill('Clara'); await page.waitForTimeout(300)
    await page.locator('[data-tag-person="c1"]').click(); await page.waitForTimeout(400)
    const rec = await store()
    check(`${w}: a person added to the event joins that community`, rec.people.find((p) => p.id === 'c1').fields?.crew === 'true' && rec.people.find((p) => p.id === 'c1').events?.includes('e1'))
    check(`${w}: the plain default stays all offers off`, !(rec.events[0].offers))
    await page.locator('[data-event-advanced] summary').click().catch(() => {}); await page.waitForTimeout(100)
    if (!(await page.locator('[data-event-advanced]').evaluate((n) => n.open))) await page.locator('[data-event-advanced] summary').click()
    // iota + zeta fields
    const nick = page.locator('[data-event-my-nickname]')
    await nick.fill('Winterfox'); await nick.dispatchEvent('change'); await page.waitForTimeout(200)
    check(`${w}: my nickname at this event is stored`, (await store()).events[0].myNickname === 'Winterfox')
    const mast = page.locator('[data-event-mastodon]')
    await mast.fill('not a host'); await mast.dispatchEvent('change'); await page.waitForTimeout(200)
    check(`${w}: a bad Mastodon host shows a line and stores nothing`, (await page.locator('[data-event-mastodon-bad]').isVisible()) && !(await store()).events[0].mastodonInstance)
    await mast.fill('Mastodon.Social'); await mast.dispatchEvent('change'); await page.waitForTimeout(200)
    check(`${w}: a good Mastodon host is stored lower-case`, (await store()).events[0].mastodonInstance === 'mastodon.social')
    await page.screenshot({ path: `${SHOTS}/answers-43-advanced-${w}.png` })
    // delta: focus the event in the Web, open the filter list, clear with Undo
    await openEvent()
    await page.locator('[data-event-web-focus]').click(); await page.waitForTimeout(600)
    await page.locator('[data-filter-badge]').click(); await page.waitForTimeout(400)
    const clear = page.locator('[data-filter-off-all]')
    check(`${w}: the filter list has a "Clear filters" button`, (await clear.count()) === 1 && (await clear.innerText()).trim() === 'Clear filters')
    await clear.click(); await page.waitForTimeout(400)
    check(`${w}: clearing empties the filters and shows an Undo`, (await store()).uiRings.show.length === 0 && (await page.locator('[data-undo-event]').isVisible()))
    await page.screenshot({ path: `${SHOTS}/answers-43-undo-${w}.png` })
    await page.locator('[data-undo-event]').click(); await page.waitForTimeout(500)
    check(`${w}: Undo restores the filter set`, JSON.stringify((await store()).uiRings.show) === '["event:e1"]' && (await page.locator('[data-filter-badge]').count()) === 1)
    // the Undo toast lasts about 5 seconds
    await page.locator('[data-filter-badge]').dispatchEvent('contextmenu'); await page.waitForTimeout(400)
    check(`${w}: long press clears too, with the Undo`, (await store()).uiRings.show.length === 0 && (await page.locator('[data-undo-event]').isVisible()))
    await page.mouse.move(w - 2, h - 2)   // a pointer resting on the notice holds its timer (toast.ts)
    await page.waitForTimeout(6000)
    check(`${w}: the Undo goes after about 5 seconds`, !(await page.locator('[data-undo-event]').isVisible()))
    // alpha: people of one event sit together inside their ring; no dot overlaps another
    const crowd = Array.from({ length: 14 }, (_, i) => P(`w${i}`, `Wanda Probe${i}`, 'friend', i < 8 ? ['e1'] : ['e2']))
    await page.evaluate(([ppl, evs]) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.people = ppl; r.events = evs; r.uiRings = { perRingLimitOff: true }; r.inventory = []; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, [crowd, [EV, { ...EV, id: 'e2', name: 'Summer Fest' }]])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1000)
    await page.locator('.tabs [data-go="web"]').first().click(); await page.waitForTimeout(600)
    const dots = await page.locator('button.node[data-pid]').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); const f = n.querySelector('.avatar, [class*="av"]')?.getBoundingClientRect() ?? r; return { id: n.getAttribute('data-pid'), x: f.x + f.width / 2, y: f.y + f.height / 2, d: f.width } }))
    const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(a.length, 1)
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    const g1 = dots.filter((d) => Number(d.id.slice(1)) < 8), g2 = dots.filter((d) => Number(d.id.slice(1)) >= 8)
    const within = mean(g1.flatMap((a, i) => g1.slice(i + 1).map((b) => dist(a, b))))
    const across = mean(g1.flatMap((a) => g2.map((b) => dist(a, b))))
    check(`${w}: all 14 dots drawn`, dots.length === 14, String(dots.length))
    check(`${w}: people of one event sit closer together than to the other event's people`, within < across, `within ${within.toFixed(0)} across ${across.toFixed(0)}`)
    check(`${w}: no two dots overlap`, dots.every((a, i) => dots.every((b, j) => j <= i || dist(a, b) >= (a.d + b.d) / 2 - 2)))
    await page.screenshot({ path: `${SHOTS}/answers-43-web-cluster-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
