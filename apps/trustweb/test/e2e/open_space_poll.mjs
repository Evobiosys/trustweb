// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 open-space-date-poll (headless, stock dev only): the host proposes dates in the poll of an online open space, a guest answers yes/maybe/no,
 * "Use this date" sets the event date. Both viewports.
 * PORT=5485 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node open_space.mjs   (synthetic record only)
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5485}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...extra })
const HOST = { id: 'e1', name: 'Saturday open day', from: `${day(21)}T10:00`, to: `${day(21)}T16:00`, where: 'Online', createdAt: 1, attended: true, hosts: ['Jakob'], openSpace: { acts: [] } }
const GUEST = { ...HOST, fromLink: true, hosts: ['Hanna Host'] }
const record = (ev) => ({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people: [P('h', 'Hanna Host', 'friend', { events: ['e1'] })], events: [ev] })
try {
  for (const [w, h, tag] of [[360, 780, '360'], [1280, 900, '1280']]) {
    for (const [role, ev] of [['host', HOST], ['guest', GUEST]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
      const page = await ctx.newPage()
      const errors = []; page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
      await page.goto(URL); await page.waitForTimeout(1200)
      await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, record(ev))
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
      const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
      const noScroll = async (label) => check(`${tag} ${role}: ${label}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
      await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)

      if (role === 'guest') {
        check(`${tag} guest: no poll and no add button while the host has none`, (await page.locator('[data-os-poll]').count()) === 0)
        await page.evaluate((r) => { r.events[0].openSpace.poll = { options: [{ id: 'p1', from: `${r.d}T10:00`, to: `${r.d}T14:00`, votes: {} }] }; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, { ...(await store()), d: day(28) })
        await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
        await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
        if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
        await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
        check(`${tag} guest: sees the date, can answer, cannot add or choose`, (await page.locator('[data-poll-opt="p1"]').count()) === 1 && (await page.locator('[data-poll-add]').count()) === 0 && (await page.locator('[data-poll-use]').count()) === 0)
        await page.locator('[data-poll-vote="p1:maybe"]').click(); await page.waitForTimeout(250)
        const v = Object.values((await store()).events[0].openSpace.poll.options[0].votes)
        check(`${tag} guest: the answer is stored by token, never my name`, v.length === 1 && v[0].v === 'maybe' && !JSON.stringify(v).includes('Jakob'))
        check(`${tag} guest: the chip is pressed and the count shows`, (await page.locator('[data-poll-vote="p1:maybe"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-poll-tally]').innerText()).includes('1 maybe'))
        await noScroll('poll')
        await page.screenshot({ path: `${SHOTS}/open-space-date-poll-guest-${tag}.png` })
      } else {
        check(`${tag} host: the poll starts empty with a hint and a folded add form`, (await page.locator('[data-os-poll]').count()) === 1 && (await page.locator('[data-poll-form]').count()) === 0)
        await page.locator('[data-poll-add]').click(); await page.waitForTimeout(200)
        await page.locator('[data-poll-go]').click(); await page.waitForTimeout(200)
        check(`${tag} host: an empty date is refused with a line`, (await page.locator('[data-poll-error]').count()) === 1)
        await page.locator('[data-poll-from]').fill(`${day(28)}T10:00`)
        await page.locator('[data-poll-to]').fill('14:00')
        await page.locator('[data-poll-go]').click(); await page.waitForTimeout(250)
        await page.locator('[data-poll-from]').fill(`${day(35)}T09:00`)
        await page.locator('[data-poll-go]').click(); await page.waitForTimeout(250)
        let poll = (await store()).events[0].openSpace.poll
        check(`${tag} host: two dates in the poll, the first with an end`, poll.options.length === 2 && poll.options[0].to === `${day(28)}T14:00` && !poll.options[1].to)
        const [o1, o2] = poll.options.map((o) => o.id)
        await page.locator(`[data-poll-vote="${o2}:yes"]`).click(); await page.waitForTimeout(250)
        check(`${tag} host: my yes leads`, (await page.locator(`[data-poll-opt="${o2}"] [data-poll-leading]`).count()) === 1 && (await page.locator(`[data-poll-opt="${o2}"] [data-poll-tally]`).innerText()).includes('1 yes'))
        await page.locator(`[data-poll-vote="${o1}:no"]`).click(); await page.waitForTimeout(250)
        check(`${tag} host: an unpressed answer is struck through (greyscale)`, (await page.locator(`[data-poll-vote="${o1}:yes"]`).getAttribute('class')).includes('tw-off'))
        await noScroll('poll')
        await page.screenshot({ path: `${SHOTS}/open-space-date-poll-host-${tag}.png` })
        await page.locator(`[data-poll-use="${o2}"]`).click(); await page.waitForTimeout(300)
        const e = (await store()).events[0]
        check(`${tag} host: "Use this date" sets the event date and closes the poll`, e.from === `${day(35)}T09:00` && e.to === undefined && e.openSpace.poll.chosen === o2)
        check(`${tag} host: the page shows Chosen and no more Use buttons or add form`, (await page.locator(`[data-poll-opt="${o2}"] [data-poll-chosen]`).count()) === 1 && (await page.locator('[data-poll-use]').count()) === 0 && (await page.locator('[data-poll-add]').count()) === 0)
        check(`${tag} host: the open-space window follows the new date`, (await page.locator('[data-os-window]').innerText()).includes(day(35)))
        await page.screenshot({ path: `${SHOTS}/open-space-date-poll-chosen-${tag}.png` })
      }
      check(`${tag} ${role}: no page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
