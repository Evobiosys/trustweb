// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-people-list (headless, stock dev server, synthetic record): "People at this event" at the top of the event page, hosts first; 20 people
 * show the first 10 + "Show all (20)", collapsible back; [Event chat] [Add people] below in the event colour; Add people tags a person. 360x780 and 1280x900.
 * PORT=5461 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node event_people_list.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const guests = (n) => Array.from({ length: n }, (_, i) => P(`g${i}`, `Guest ${i}`, { events: ['e1'] }))
const mk = (n) => ({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [P('h', 'Hanna Host'), P('z', 'Zora Extra'), ...guests(n)],
  events: [{ id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna Host'] }, { id: 'e2', name: 'Small', from: day(4), where: 'Alm', createdAt: 1, attended: true }] })
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); sessionStorage.clear() }, JSON.stringify(mk(20)))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const openEvent = async (id) => {
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
      await page.waitForTimeout(200)
      await page.locator(`[data-event="${id}"]`).click(); await page.waitForTimeout(400)
    }
    const shown = () => page.locator('[data-event-people-list] [data-person-chip]').count()
    await openEvent('e1')
    check(`${w}: the section says People at this event, never Join`, /People at this event/.test(await page.locator('[data-event-people]').innerText()) && !/\bJoin\b/.test(await page.locator('[data-event-people]').innerText()))
    check(`${w}: 21 people: the first 10 show, Hanna (host) first`, (await shown()) === 10 && (await page.locator('[data-event-people-list] [data-person-chip]').first().textContent()) === 'Hanna Host')
    check(`${w}: Show all (21) is offered`, /Show all \(21\)/.test(await page.locator('[data-event-people-toggle]').textContent()))
    await page.locator('[data-event-people-toggle]').click(); await page.waitForTimeout(250)
    check(`${w}: Show all lists all 21, the button now says Show fewer`, (await shown()) === 21 && /Show fewer/.test(await page.locator('[data-event-people-toggle]').textContent()))
    await page.locator('[data-event-people-toggle]').click(); await page.waitForTimeout(250)
    check(`${w}: Show fewer returns to 10`, (await shown()) === 10)
    const chat = page.locator('[data-event-chat]'); const add = page.locator('[data-event-add-people]')
    const [cb, ab, lb] = await Promise.all([chat.boundingBox(), add.boundingBox(), page.locator('[data-event-people-list]').boundingBox()])
    check(`${w}: Event chat and Add people sit below the list, side by side`, !!cb && !!ab && cb.y > lb.y + lb.height - 1 && Math.abs(cb.y - ab.y) < 4)
    check(`${w}: the buttons are chips in the event colour`, await chat.evaluate((n) => n.classList.contains('chip') && getComputedStyle(n).color !== getComputedStyle(document.body).color))
    check(`${w}: Message everyone is gone`, !/Message everyone/.test(await page.locator('.events-page').innerText()))
    await page.screenshot({ path: `${SHOTS}/event-people-list-${w}.png` })
    await add.click(); await page.waitForTimeout(300)
    await page.locator('.events-page [data-event-people] [data-event-tag-search]').first().fill('Zora'); await page.waitForTimeout(250)
    await page.locator('.events-page [data-event-people] [data-tag-person]').first().click(); await page.waitForTimeout(400)
    check(`${w}: Add people tags Zora with the event`, (await rec(page)).people.find((p) => p.id === 'z').events?.includes('e1') === true)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r) }, JSON.stringify(mk(3)))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900); await openEvent('e1')
    check(`${w}: 5 people: all show, no Show all`, (await shown()) === 4 && (await page.locator('[data-event-people-toggle]').count()) === 0)
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
