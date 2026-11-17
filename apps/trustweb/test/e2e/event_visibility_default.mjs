// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-event-visibility-3 proof (headless, stock dev server): PORT=5301 SHOTS=<dir> PW=<playwright-core index.js> EXE=<chromium> node event_visibility_default.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5301}/`
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const mk = (events) => ({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [], events })
const E = { id: 'e1', name: 'Winter IYG', from: day(3), where: 'Vienna', createdAt: 1, attended: true }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const open = async (page, record) => {
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r) }, JSON.stringify(record))
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
  await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
  await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
  await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
}
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))

    // 2: an organizer (not host) sees and uses "How I show at this event"
    await open(page, mk([{ ...E, organizers: ['Jakob'] }]))
    await page.locator('[data-event-advanced] summary').click(); await page.waitForTimeout(250)
    check(`${tag}: organizer sees "How I show at this event", default discoverable`, (await page.locator('[data-event-visibility]').getAttribute('data-event-visibility')) === 'discoverable')
    await page.locator('[data-event-visibility-opt="off"]').click(); await page.waitForTimeout(250)
    check(`${tag}: organizer's choice is stored`, (await rec(page)).events[0].showMe === 'off')
    check(`${tag}: organizer gets no suggestion card`, (await page.locator('[data-event-host-default-ask]').count()) === 0)

    // 3: the organizer sets the default for participants
    check(`${tag}: organizer sees the participants default, none chosen`, (await page.locator('[data-event-host-default]').getAttribute('data-event-host-default')) === '')
    await page.locator('[data-event-host-default-opt="open"]').click(); await page.waitForTimeout(250)
    check(`${tag}: default stored`, (await rec(page)).events[0].hostDefault === 'open')
    check(`${tag}: default button pressed`, (await page.locator('[data-event-host-default-opt="open"]').getAttribute('aria-pressed')) === 'true')

    // 3: a participant is asked once
    await open(page, mk([{ ...E, fromLink: true, hosts: ['Someone Else'], hostDefault: 'off' }]))
    check(`${tag}: participant sees "The host suggests: Off."`, ((await page.locator('[data-event-host-default-ask]').innerText()).includes('The host suggests: Off')))
    const card = await page.locator('[data-event-host-default-ask]').boundingBox(); const chip = await page.locator('[data-event-tag-chip]').boundingBox()
    check(`${tag}: card overlaps no control`, card && chip && !overlap(card, chip) && card.x >= 0 && card.x + card.width <= w + 1)
    check(`${tag}: no host-side default row for a participant`, (await page.locator('[data-event-host-default]').count()) === 0)
    await page.locator('[data-event-host-default-keep]').click(); await page.waitForTimeout(250)
    let r = (await rec(page)).events[0]
    check(`${tag}: Keep adopts it and marks it answered`, r.showMe === 'off' && r.hostDefaultAnswered === true)
    check(`${tag}: card gone`, (await page.locator('[data-event-host-default-ask]').count()) === 0)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300); await page.locator('[data-cal-all]').click(); await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    check(`${tag}: not asked again after reload`, (await page.locator('[data-event-host-default-ask]').count()) === 0)

    // Change: mode stays, Advanced opens, my own pick wins
    await open(page, mk([{ ...E, fromLink: true, hosts: ['Someone Else'], hostDefault: 'open' }]))
    await page.locator('[data-event-host-default-change]').click(); await page.waitForTimeout(300)
    r = (await rec(page)).events[0]
    check(`${tag}: Change leaves my mode, marks answered`, r.showMe === undefined && r.hostDefaultAnswered === true)
    check(`${tag}: Change opens Advanced`, await page.locator('[data-event-advanced]').evaluate((n) => n.open))
    await page.locator('[data-event-visibility-opt="open"]').click(); await page.waitForTimeout(250)
    check(`${tag}: my own choice wins`, (await rec(page)).events[0].showMe === 'open')
    check(`${tag}: no page errors`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
