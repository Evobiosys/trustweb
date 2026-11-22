// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 ask-event-limit (headless, stock dev only): the ask reach filter limits an ask by an event's attendees: `#event:<name>` in Also include / Hide from offers the event, the chip stores `event:<id>`, a one-line hint says what it means. PORT=5480 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node ask_event_limit.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5480}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { quietKeepCopy, ringsFirst } = await import('./rings_first.mjs')
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const peer = (id, name) => ({ id, displayName: name, did: 'did:test:' + id, ring: 'friend', connectedAt: 1 })
const P = (id, name, ring, events) => ({ id: 'p-' + id, name, context: '', ring, metAt: 1, lines: [], fields: {}, peerId: id, ...(events ? { events } : {}) })
const PEOPLE = [P('cy', 'Cy Stone', 'closest'), P('di', 'Di Moss', 'friend', ['ev1']), P('ed', 'Ed Park', 'acquaintance', ['ev1']), P('an', 'Anna Huber', 'acquaintance')]
const EVENTS = [{ id: 'ev1', name: 'Winter IYG', from: 1, where: 'Wien', createdAt: 1, attended: true }]
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ppl, peers, events]) => {
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers, log: [], inventory: [], events }))
    }, [PEOPLE, PEOPLE.map((p) => peer(p.peerId, p.name)), EVENTS])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    await page.locator('[data-open-query]:visible').first().click(); await page.waitForTimeout(400)

    check(`${w}: the Also include row carries the one-line hint`, (await page.locator('[data-aud-row="add"] [data-aud-event-hint]').innerText()) === '#event:<name> = people who attended')
    await page.locator('[data-aud-zone="closest"]').click(); await page.waitForTimeout(200)
    await page.locator('[data-aud-input="add"]').fill('#event:win'); await page.waitForTimeout(150)
    check(`${w}: #event:win offers the event`, (await page.locator('[data-aud-found="add"] [data-aud-pick="event:ev1"]').innerText()) === '#event:Winter IYG')
    await page.locator('[data-aud-found="add"] [data-aud-pick="event:ev1"]').click(); await page.waitForTimeout(250)
    check(`${w}: the event is an Also include chip`, (await page.locator('[data-aud-chips="add"] [data-aud-chip="event:ev1"]').innerText()) === '#event:Winter IYG ×')
    const a1 = (await store()).askAudience
    check(`${w}: stored as event:<id> with the zone`, a1?.zone === 'closest' && a1?.add?.join() === 'event:ev1', JSON.stringify(a1))
    await page.screenshot({ path: `${SHOTS}/ask-event-limit-add-${w}.png` })

    await page.locator('[data-aud-chip="event:ev1"]').click(); await page.waitForTimeout(250)
    await page.locator('[data-aud-input="exclude"]').fill('#winter'); await page.waitForTimeout(150)
    await page.locator('[data-aud-found="exclude"] [data-aud-pick="event:ev1"]').click(); await page.waitForTimeout(250)
    const a2 = (await store()).askAudience
    check(`${w}: Hide from takes the event too`, a2?.add?.length === 0 && a2?.exclude?.join() === 'event:ev1', JSON.stringify(a2))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
