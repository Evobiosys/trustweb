// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-roles proof (headless, stock dev server): PORT=5431 SHOTS=<dir> node event_roles.mjs. EXE=<chromium headless shell> if the default is not installed. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring, events = []) => ({ id, name, context: '', ring, metAt: 1, lines: [], events })
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, hosts: ['b1'] }
const boxes = (page, a, b) => page.evaluate(([x, y]) => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const p = r(x), q = r(y); return !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top) }, [a, b])
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: false })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate(([ev, ppl]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, strikeSwitchedOff: true, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [], log: [], events: [ev] })), [EV, [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'friend')]])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)

    check(`${tag}: event tag chip shows #event:<name>`, (await page.locator('[data-event-tag-chip]').textContent()) === '#event:Winter IYG')
    check(`${tag}: roles collapsed shows the placeholder, no tech support`, (await page.locator('[data-event-roles-line]').textContent()) === 'Organizer' && (await page.locator('[data-role="techSupport"]').count()) === 0)
    check(`${tag}: line and V expander do not overlap`, !(await boxes(page, '[data-event-roles-line]', '[data-event-roles-toggle]')))
    await page.locator('[data-event-roles-line]').click(); await page.waitForTimeout(200)
    check(`${tag}: press on the line expands three rows, tech support last with its hint`, (await page.locator('[data-event-roles] [data-role]').evaluateAll((n) => n.map((x) => x.dataset.role).join())) === 'organizers,hosts,techSupport' && (await page.locator('[data-role-tech-hint]').count()) === 1)
    check(`${tag}: host chip shows the person's name, not the id`, (await page.locator('[data-role="hosts"] [data-role-chip="b1"]').textContent()).includes('Ben Gruber'))
    // new person from the organizers picker
    const search = page.locator('[data-role="organizers"] [data-role-search]')
    await search.fill('Zed Newcomer'); await page.waitForTimeout(150)
    check(`${tag}: no match -> the LAST row adds a new person`, (await page.locator('[data-role="organizers"] .chips > *').last().getAttribute('data-person-create')) === 'Zed Newcomer')
    await page.locator('[data-role="organizers"] [data-person-create]').click(); await page.waitForTimeout(300)
    check(`${tag}: the new person is an organizer, the line says so`, (await page.locator('[data-event-roles-line]').textContent()) === 'Organized by Zed Newcomer')
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const zed = rec.people.find((p) => p.name === 'Zed Newcomer')
    check(`${tag}: new person in Not-yet-sorted, tagged with the event; no duplicate`, zed?.ring === 'unsorted' && zed.events?.includes('e1') && rec.people.length === 3)
    await page.locator('[data-role="organizers"] [data-role-search]').fill('zed newcomer'); await page.waitForTimeout(150)
    check(`${tag}: an exact name (other case) offers no second create row`, (await page.locator('[data-role="organizers"] [data-person-create]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/event-roles-expanded-${tag}.png` })
    // press again collapses; long press / right click expands and focuses the first editor
    await page.locator('[data-event-roles-line]').click(); await page.waitForTimeout(200)
    check(`${tag}: second press collapses`, (await page.locator('[data-event-roles] .roles-list').count()) === 0)
    await page.locator('[data-event-roles-line]').click({ button: 'right' }); await page.waitForTimeout(400)
    check(`${tag}: right click expands and focuses the first editor`, await page.evaluate(() => document.activeElement?.hasAttribute('data-role-search') && document.activeElement.closest('[data-role]')?.dataset.role === 'organizers'))
    await page.locator('[data-event-roles-toggle]').click(); await page.waitForTimeout(200)
    check(`${tag}: the V toggle collapses too`, (await page.locator('[data-event-roles] .roles-list').count()) === 0)
    // attendees: renamed headings, identify picker, others related, strike-through
    const heads = await page.locator('.events-page h3').allTextContents()
    check(`${tag}: headings Identify a person / People associated with this event`, heads.includes('Identify a person') && heads.some((t) => t.startsWith('People associated with this event')))
    await page.locator('[data-event-tag-search]').fill('Anna'); await page.waitForTimeout(150)
    await page.locator('[data-tag-person="a1"]').click(); await page.waitForTimeout(300)
    check(`${tag}: picking a match tags the person (attendee row)`, (await page.locator('[data-attendee="a1"]').count()) === 1)
    await page.locator('[data-event-advanced] summary').click(); await page.waitForTimeout(200)
    check(`${tag}: Others related: Ben (host only) is listed, tagged Zed and Anna are not`, (await page.locator('[data-event-others] [data-other-person]').evaluateAll((n) => n.map((x) => x.dataset.otherPerson).join())) === 'b1')
    const att = page.locator('[data-event-attended]')
    check(`${tag}: attended on: not struck through`, (await att.evaluate((n) => getComputedStyle(n).textDecorationLine)) !== 'line-through' && (await att.getAttribute('aria-pressed')) === 'true')
    await att.click(); await page.waitForTimeout(200)
    check(`${tag}: attended off: struck through, aria-pressed=false`, (await att.evaluate((n) => getComputedStyle(n).textDecorationLine)) === 'line-through' && (await att.getAttribute('aria-pressed')) === 'false')
    check(`${tag}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.screenshot({ path: `${SHOTS}/event-roles-page-${tag}.png` })
    // tag chip long press (right click) opens the edit form
    await page.locator('[data-event-tag-chip]').click({ button: 'right' }); await page.waitForTimeout(300)
    check(`${tag}: right click on the tag chip opens the edit form`, (await page.locator('[data-event-save]').count()) === 1)
    check(`${tag}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await page.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
