// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-open-space (headless, stock dev only): the event type "Online open space" in the editor, the shared schedule on the event page
 * (propose, "I join" per activity, names only for people the list may show), the host flag "Everyone can see everyone". Both viewports.
 * PORT=5304 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node open_space.mjs   (synthetic record only)
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5304}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...extra })
const PEOPLE = [P('a', 'Ada Lovelace', 'friend', { events: ['e1'], eventShow: { e1: 'discoverable' } }), P('b', 'Ben Gruber', 'close', { events: ['e1'] }), P('c', 'Cleo Moser', 'friend', { events: ['e1'], eventShow: { e1: 'off' } })]
const EV = { id: 'e1', name: 'Saturday open day', from: `${day(21)}T10:00`, to: `${day(21)}T16:00`, where: 'Online', createdAt: 1, attended: true, hosts: ['Jakob'], openSpace: { acts: [{ id: 'a1', title: 'Somatics class', slot: '11:00', by: 'Ben Gruber', description: 'Gentle movement', joins: {} }] } }
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: PEOPLE, events: [EV] }
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const noScroll = async (label) => check(`${tag}: ${label}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const toEvents = async () => {
      await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
    }

    // the schedule on the event page
    await toEvents()
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    check(`${tag}: the open space shows its day and window`, (await page.locator('[data-os-window]').innerText()).includes('10:00–16:00'))
    check(`${tag}: Ben's activity is on the schedule, not joined`, (await page.locator('[data-os-act="a1"] [data-os-title]').innerText()) === 'Somatics class' && (await page.locator('[data-os-join="a1"]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-os-join="a1"]').click(); await page.waitForTimeout(250)
    let acts = (await store()).events[0].openSpace.acts
    check(`${tag}: "I join" stores a token with a time, never my name`, Object.values(acts[0].joins).filter((t) => t > 0).length === 1 && !JSON.stringify(acts[0].joins).includes('Jakob'))
    check(`${tag}: the row says I join`, (await page.locator('[data-os-who="a1"]').innerText()).includes('You') && (await page.locator('[data-os-join="a1"]').getAttribute('aria-pressed')) === 'true')
    await page.locator('[data-os-join="a1"]').click(); await page.waitForTimeout(250)
    check(`${tag}: tapping again leaves (negative time)`, Object.values((await store()).events[0].openSpace.acts[0].joins).every((t) => t < 0))
    await page.locator('[data-os-join="a1"]').click(); await page.waitForTimeout(250)

    // propose
    check(`${tag}: the proposal form is folded`, (await page.locator('[data-os-form]').count()) === 0)
    await page.locator('[data-os-propose]').click(); await page.waitForTimeout(200)
    await page.locator('[data-os-input-title]').fill('Walk and talk')
    await page.locator('[data-os-slot]').fill('07:00')
    await page.locator('[data-os-add]').click(); await page.waitForTimeout(250)
    check(`${tag}: a slot outside the window is refused with a line`, (await page.locator('[data-os-error]').innerText()).includes('window') && (await store()).events[0].openSpace.acts.length === 1)
    await page.locator('[data-os-slot]').fill('13:30')
    await page.locator('[data-os-input-desc]').fill('Around the park')
    await page.locator('[data-os-add]').click(); await page.waitForTimeout(300)
    acts = (await store()).events[0].openSpace.acts
    check(`${tag}: the proposal joins the schedule, sorted by slot, proposer joined`, acts.length === 2 && acts[1].title === 'Walk and talk' && acts[1].by === 'Jakob' && Object.values(acts[1].joins).filter((t) => t > 0).length === 1)
    check(`${tag}: both rows show`, (await page.locator('[data-os-act]').evaluateAll((n) => n.map((x) => x.querySelector('.os-slot').textContent).join())) === '11:00,13:30')
    await noScroll('schedule')
    await page.screenshot({ path: `${SHOTS}/steer-open-space-schedule-${tag}.png` })

    // attendee list default: only the open person
    check(`${tag}: default list shows Ben, not Ada (discoverable) or Cleo (off)`, (await page.locator('[data-attendee]').evaluateAll((n) => n.map((x) => x.dataset.attendee).join())) === 'b')

    // editor: type chooser, window error, host flag
    await page.locator('[data-event-edit]').click(); await page.waitForTimeout(300)
    check(`${tag}: editor offers the two types; open space is on, and locked on by its activities`, (await page.locator('[data-editor-type="open-space"][aria-pressed="true"]').count()) === 1 && (await page.locator('[data-editor-type="event"]').isDisabled()))
    await page.locator('[data-more-toggle]').first().click(); await page.waitForTimeout(150)
    check(`${tag}: host flag is off and optional`, (await page.locator('[data-editor-show-all-toggle]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-editor-show-all-toggle]').click(); await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/steer-open-space-editor-${tag}.png` })
    await page.locator('[data-editor-to]').fill(`${day(22)}T12:00`)
    await page.locator('[data-event-save]').click(); await page.waitForTimeout(250)
    check(`${tag}: an end on another day is refused`, (await page.locator('[data-event-error]').count()) === 1)
    await page.locator('[data-editor-to]').fill(`${day(21)}T17:00`)
    await page.locator('[data-event-save]').click(); await page.waitForTimeout(350)
    const saved = (await store()).events[0]
    check(`${tag}: saved: flag stored, window changed, activities kept`, saved.showAll === true && saved.to.endsWith('T17:00') && saved.openSpace.acts.length === 2)
    check(`${tag}: with the flag the discoverable Ada is listed, Cleo (off) is not`, (await page.locator('[data-attendee]').evaluateAll((n) => n.map((x) => x.dataset.attendee).join())) === 'a,b')

    // a new open space from the editor
    await toEvents()
    await page.locator('[data-event-add]').click(); await page.waitForTimeout(300)
    check(`${tag}: a new event is a plain event`, (await page.locator('[data-editor-type="event"][aria-pressed="true"]').count()) === 1)
    await page.locator('[data-editor-name]').fill('Second open day')
    await page.locator('[data-editor-type="open-space"]').click(); await page.waitForTimeout(200)
    check(`${tag}: choosing open space gives start and end times`, (await page.locator('[data-editor-from]').getAttribute('type')) === 'datetime-local' && (await page.locator('[data-editor-fullday]').count()) === 0)
    await page.locator('[data-editor-from]').fill(`${day(30)}T09:00`)
    await page.locator('[data-editor-to]').fill(`${day(30)}T12:00`)
    await page.locator('[data-event-save]').click(); await page.waitForTimeout(350)
    const second = (await store()).events.find((e) => e.name === 'Second open day')
    check(`${tag}: saved as an open space with an empty schedule, no flag`, !!second?.openSpace && second.openSpace.acts.length === 0 && second.showAll === undefined)
    check(`${tag}: its page invites the first proposal`, (await page.locator('[data-os-empty]').count()) === 1)
    await noScroll('second open space')
    check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
