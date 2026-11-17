// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 3 (headless, stock dev server, synthetic record): the algorithmic emoji before event titles (list row, page header, QR page) and
 * resource titles (My resources); Settings > Appearance "Emoji before titles" turns it off. 360x780 and 1280x900.
 * PORT=5485 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node a44d_title_emoji.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5485}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], people: [],
  inventory: [{ id: 'i1', text: 'Sommerfest tent', audience: 'friends', included: true, createdAt: 5 }],
  events: [{ id: 'e1', name: 'Winter OG', from: day(3), where: 'Vienna', createdAt: 1, attended: true }] }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1000)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    check(`${w}: the event row reads "❄️ Winter OG"`, (await page.locator('[data-event="e1"] b').textContent()) === '❄️ Winter OG')
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    check(`${w}: the page header carries the snowflake before the name`, (await page.locator('[data-event-name-line] [data-title-emoji]').getAttribute('data-title-emoji')) === '❄️')
    check(`${w}: the stored name is untouched`, (await rec(page)).events[0].name === 'Winter OG')
    await page.screenshot({ path: `${SHOTS}/answers-44d-emoji-event-${w}.png` })
    await page.locator('[data-event-qr]').first().click(); await page.waitForTimeout(600)
    check(`${w}: the QR page names the event with its emoji`, (await page.locator('[data-qr-title="event"]').textContent()) === '❄️ Winter OG')
    await page.goBack().catch(() => {}); await page.waitForTimeout(300)
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(300)
    if (!(await page.locator('[data-item="i1"]').count())) { await page.locator('[data-inv-zoom], [data-zoom]').first().click().catch(() => {}); await page.waitForTimeout(300) }
    const res = await page.locator('[data-item="i1"]').first().textContent().catch(() => '')
    check(`${w}: the resource title carries ☀️`, (res ?? '').includes('☀️ Sommerfest tent'), res)
    // Settings > Appearance: off
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    await page.evaluate(() => { let d = document.querySelector('[data-title-emoji-switch]')?.closest('details'); while (d) { d.open = true; d = d.parentElement?.closest('details') } })
    const sw = page.locator('[data-title-emoji-switch]')
    check(`${w}: the switch is on by default`, (await sw.getAttribute('aria-pressed')) === 'true')
    await sw.scrollIntoViewIfNeeded(); await sw.click(); await page.waitForTimeout(300)
    check(`${w}: off is stored and struck (tw-off)`, (await rec(page)).titleEmojiOff === true && (await page.locator('[data-title-emoji-switch]').getAttribute('class')).includes('tw-off'))
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    await page.reload(); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    check(`${w}: with the switch off the row is the bare name`, (await page.locator('[data-event="e1"] b').textContent()) === 'Winter OG')
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
