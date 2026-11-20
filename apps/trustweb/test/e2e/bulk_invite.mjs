// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 bulk-invite-filter (headless, stock dev server, synthetic record): Event page > Invite many: Add chips, Except chips, the live list with its
 * count, "Invite N people"; the warning about non-members of the event's community first; a personal event invites at once. 360x780 and 1280x900.
 * PORT=5479 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node bulk_invite.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5479}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, tags = [], over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], fields: Object.fromEntries(tags.map((t) => [t, 'true'])), ...over })
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'cook', colour: '#aa3300', label: 'Cooks' }]
const people = [P('a', 'Ada Member', ['iyg', 'cook']), P('b', 'Ben Member', ['iyg']), P('c', 'Cleo Cook', ['cook']), P('d', 'Dora Outsider')]
const EV = { id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true, hosts: ['Ana'], communityId: 'iyg' }
const EV2 = { id: 'e2', name: 'Picnic', from: day(5), where: 'Park', createdAt: 1, attended: true, hosts: ['Ana'] }
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [EV, EV2], twSettings: { extensions: { 'community-mighty': true, 'community-mode': true } } }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const openEvent = async (id) => {
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
      await page.waitForTimeout(200)
      await page.locator(`[data-event="${id}"]`).click(); await page.waitForTimeout(400)
    }
    const add = async (kind, text) => { const i = page.locator(`[data-bulk-input="${kind}"]`); await i.fill(text); await page.waitForTimeout(150); await i.press('Enter'); await page.waitForTimeout(150) }
    const listed = () => page.locator('[data-bulk-person]').evaluateAll((n) => n.map((x) => x.dataset.bulkPerson).sort().join())
    // community event
    await openEvent('e1')
    await page.locator('[data-event-invite-many]').click(); await page.waitForTimeout(300)
    check(`${w}: the sheet opens; nobody listed, button disabled`, (await page.locator('[data-bulk-invite]').count()) === 1 && (await listed()) === '' && await page.locator('[data-bulk-go]').isDisabled())
    await add('include', '#Cooks')
    check(`${w}: #Cooks lists its holders with the count and the button`, (await listed()) === 'a,c' && /2 people/.test(await page.locator('[data-bulk-count]').textContent()) && /Invite 2 people/.test(await page.locator('[data-bulk-go]').textContent()))
    await add('include', '@Dora')
    check(`${w}: @Dora adds her`, (await listed()) === 'a,c,d')
    await add('exclude', '#IYG')
    check(`${w}: Except #IYG takes the community's members out`, (await listed()) === 'c,d')
    await page.locator('[data-bulk-row="exclude"] [data-bulk-chip]').click(); await page.waitForTimeout(150)
    check(`${w}: tapping the Except chip puts them back`, (await listed()) === 'a,c,d')
    await page.screenshot({ path: `${SHOTS}/bulk-invite-sheet-${w}.png` })
    await page.locator('[data-bulk-go]').click(); await page.waitForTimeout(300)
    check(`${w}: the warning names 2 non-members of IYG; nothing invited yet`, /^2 are not members of IYG: they will see the community's events only through this invitation\.$/.test(await page.locator('[data-bulk-warning]').textContent()) && !(await rec(page)).events[0].people)
    await page.screenshot({ path: `${SHOTS}/bulk-invite-warning-${w}.png` })
    await page.locator('[data-bulk-anyway]').click(); await page.waitForTimeout(400)
    check(`${w}: Invite anyway invites the three`, JSON.stringify((await rec(page)).events[0].people) === JSON.stringify(['a', 'c', 'd']))
    // members only: no warning
    await page.locator('[data-event-invite-many]').click(); await page.waitForTimeout(300)
    await add('include', '@Ben')
    check(`${w}: already invited people are left out of the list; Ben is listed`, (await listed()) === 'b')
    await page.locator('[data-bulk-go]').click(); await page.waitForTimeout(400)
    check(`${w}: members only: no warning, invited at once`, (await page.locator('[data-bulk-warning]').count()) === 0 && (await rec(page)).events[0].people.includes('b'))
    // personal event
    await openEvent('e2')
    await page.locator('[data-event-invite-many]').click(); await page.waitForTimeout(300)
    await add('include', '@Dora')
    await page.locator('[data-bulk-go]').click(); await page.waitForTimeout(400)
    check(`${w}: a personal event warns about nobody`, (await page.locator('[data-bulk-warning]').count()) === 0 && JSON.stringify((await rec(page)).events[1].people) === JSON.stringify(['d']))
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
