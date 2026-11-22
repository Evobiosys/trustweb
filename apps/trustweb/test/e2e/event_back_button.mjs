// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-back-button (headless, stock dev server, synthetic record): a scoped Resources page reached from an event ("Resources of #event:Winter OG")
 * and from the community menu has an in-app Back (top left, before the title) that returns to where it came from. 360x780 and 1280x900.
 * PORT=5463 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node event_back_button.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5463}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }]
const EV = { id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna Host'], communityId: 'iyg' }
const inventory = [{ id: 'i1', text: 'Mine tagged', audience: 'friends', included: true, createdAt: Date.now() - 7200_000, tagAudience: ['iyg'] }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory, people: [], events: [EV], extData, twSettings: { extensions: { 'community-mighty': true, 'community-mode': true } } })
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    // from the event page
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-event-resources]').click(); await page.waitForTimeout(500)
    const scoped = page.locator('[data-scoped-resources="event"]')
    check(`${w}: event Resources page is scoped`, (await scoped.count()) === 1)
    const back = page.locator('.hdr [aria-label="Back"]')
    check(`${w}: the header has a Back, left of the title`, (await back.count()) === 1 && (await back.boundingBox()).x < (await page.locator('.hdr h2').boundingBox()).x)
    check(`${w}: Back does not overlay the title`, !overlap(await back.boundingBox(), await page.locator('.hdr h2').boundingBox()))
    await page.screenshot({ path: `${SHOTS}/event-back-button-event-${w}.png` })
    await back.click(); await page.waitForTimeout(500)
    check(`${w}: Back returns to the event page`, (await page.locator('[data-event-resources]').count()) === 1 && (await scoped.count()) === 0)
    // from the community menu
    const page2 = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })).newPage()
    page2.on('pageerror', (e) => errors.push(String(e)))
    await page2.goto(URL); await page2.waitForTimeout(900)
    await page2.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page2.reload(); await page2.waitForTimeout(1500); await page2.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page2.waitForTimeout(900)
    await page2.locator('.view-menu-btn').first().click(); await page2.waitForTimeout(250)
    await page2.locator('[data-mod-view="community"]').click(); await page2.waitForTimeout(700)
    if (w < 900 && (await page2.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page2.locator('[data-community-menu]').click(); await page2.waitForTimeout(150) }
    await page2.locator('[data-community-nav="resources"]').click(); await page2.waitForTimeout(400)
    const cb = page2.locator('[data-rs-back]')
    check(`${w}: community Resources has a Back before the title`, (await cb.count()) === 1 && (await cb.boundingBox()).x < (await page2.locator('[data-rs-title]').boundingBox()).x, JSON.stringify([await cb.count(), await cb.boundingBox(), await page2.locator('[data-rs-title]').boundingBox()]))
    check(`${w}: community Back does not overlay the title`, !overlap(await cb.boundingBox(), await page2.locator('[data-rs-title]').boundingBox()))
    await page2.screenshot({ path: `${SHOTS}/event-back-button-community-${w}.png` })
    await cb.click(); await page2.waitForTimeout(400)
    check(`${w}: community Back returns to the community Home`, (await page2.locator('[data-rs-title]').count()) === 0 && (await page2.locator('[data-community-nav="home"]').getAttribute('aria-current')) === 'page')
    check(`${w}: no document scroll sideways`, await page2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
