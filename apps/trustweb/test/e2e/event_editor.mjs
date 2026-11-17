// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor (headless, stock dev only): the calendar-style editor's row order (item 12), guests with @ / # and the co-host switch,
 * conference chooser, "Show more features" with core time behind it, the draft dialog (Save draft / Discard / Keep editing, P06 bounding box),
 * the Draft pill in Events, "I will attend", the Feed row long press opening Feed settings (43-D5), calendar tags on/off, ⋮ "Show more features".
 * PORT=5444 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node event_editor.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5444}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const P = (id, name, ring, fields = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], fields })
const EV = { id: 'e1', name: 'Winter IYG', from: '2027-12-30', where: 'Vienna', createdAt: 1, attended: true, offers: { feed: true } }
const PEOPLE = [P('a1', 'Anna Huber', 'friend', { crew: 'true' }), P('b1', 'Ben Gruber', 'close', { crew: 'true' }), P('c1', 'Clara Moser', 'friend')]
const TAGS = [{ id: 'crew', colour: '#aa3300', label: 'IYG Crew' }]
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ev, ppl, tags]) => {
      localStorage.setItem('trustweb.v1.colourtags', JSON.stringify(tags))
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers: [], log: [], inventory: [], events: [ev], feed: { on: true } }))
    }, [EV, PEOPLE, TAGS])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const box = (sel) => page.locator(sel).first().boundingBox()
    const noScroll = async (label) => check(`${w}: ${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const toEvents = async () => {
      await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
    }

    await toEvents()
    await page.locator('[data-event-add]').click(); await page.waitForTimeout(300)
    const order = await page.locator('[data-event-editor] [data-editor-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-editor-row')))
    check(`${w}: editor rows in the calendar order`, JSON.stringify(order) === JSON.stringify(['name', 'time', 'guests', 'location', 'description', 'more']), order.join(','))
    const ys = []
    for (const r of order) ys.push((await box(`[data-editor-row="${r}"]`))?.y ?? -1)
    check(`${w}: rows stack top to bottom`, ys.every((y, i) => i === 0 || y > ys[i - 1]), ys.join(','))
    check(`${w}: the creator is the first guest, as co-host`, (await page.locator('[data-editor-me="cohost"]').count()) === 1 && (await page.locator('[data-editor-me-cohost][aria-pressed="true"]').count()) === 1)
    check(`${w}: core time hidden until Show more features`, !(await page.locator('[data-editor-coreFrom]').isVisible()) && (await page.locator('[data-editor-more]').innerText()).includes('Show more features'))
    check(`${w}: optional community box is minuscule (opt-min)`, (await page.locator('[data-event-community].opt-min').count()) === 1 && (await page.locator('[data-event-community]').inputValue()) === '')
    await page.locator('[data-more-toggle]').first().click(); await page.waitForTimeout(150)
    check(`${w}: V turns into the roof and shows the core time`, (await page.locator('[data-more-toggle]').first().innerText()) === '▴' && await page.locator('[data-editor-coreFrom]').isVisible())

    await page.locator('[data-editor-name]').fill('Picnic')
    await page.locator('[data-editor-guests]').fill('#iyg'); await page.waitForTimeout(150)
    check(`${w}: # offers the group with all its people`, (await page.locator('[data-person-tag="crew"]').count()) === 1)
    await page.locator('[data-person-tag="crew"]').click(); await page.waitForTimeout(250)
    check(`${w}: the group's two people are guests`, (await page.locator('[data-editor-guest]').count()) === 2)
    check(`${w}: the guest box keeps the cursor for the next one`, await page.evaluate(() => document.activeElement?.hasAttribute('data-editor-guests')))
    await page.locator('[data-editor-cohost="a1"]').click(); await page.waitForTimeout(200)
    check(`${w}: the co-host switch at the right makes Anna a co-host`, (await page.locator('[data-editor-cohost="a1"][aria-pressed="true"]').count()) === 1)
    const g = await box('[data-editor-guest="a1"]'); const t = await box('[data-editor-cohost="a1"]')
    check(`${w}: co-host switch sits at the right of the guest`, g && t && t.x > g.x + g.width / 3)
    await page.locator('[data-editor-guests]').fill('@cla'); await page.waitForTimeout(150)
    check(`${w}: @ offers people only`, (await page.locator('[data-person-tag]').count()) === 0 && (await page.locator('[data-editor-guests-pick="c1"]').count()) === 1)
    await page.locator('[data-editor-guests]').press('Enter'); await page.waitForTimeout(250)
    check(`${w}: Enter picks the first match`, (await page.locator('[data-editor-guest="c1"]').count()) === 1)

    await page.locator('[data-editor-where]').fill('Prater')
    await page.locator('[data-editor-conference-toggle]').click(); await page.waitForTimeout(150)
    const wh = await box('[data-editor-where]'); const cb = await box('[data-editor-conference-toggle]')
    check(`${w}: the conference button sits at the right of the place`, wh && cb && cb.x >= wh.x + wh.width - 1 && Math.abs(cb.y - wh.y) < 30)
    check(`${w}: providers greyed while none is connected`, (await page.locator('[data-editor-conf].opt-min').count()) === 4)
    await page.locator('[data-editor-conf="kmeet"]').click(); await page.locator('[data-editor-conf="zoom"]').click(); await page.waitForTimeout(150)
    await page.locator('[data-editor-conf-url="kmeet"]').fill('https://kmeet.infomaniak.com/picnic')
    await page.locator('[data-editor-conf-url="zoom"]').fill('https://zoom.us/j/123')
    await noScroll('editor')
    await page.screenshot({ path: `${SHOTS}/event-editor-${w}-form.png`, fullPage: false })

    // Leaving with changes: the draft dialog.
    await page.locator('[data-event-cancel]').click(); await page.waitForTimeout(200)
    check(`${w}: leaving with changes asks (draft dialog)`, (await page.locator('[data-draft-dialog]').count()) === 1)
    const btns = await Promise.all(['[data-draft-save]', '[data-draft-discard]', '[data-draft-keep]'].map(box))
    check(`${w}: P06 the dialog's three buttons do not overlap and fit the screen`, btns.every(Boolean) && !overlap(btns[0], btns[1]) && !overlap(btns[1], btns[2]) && btns.every((b) => b.x >= 0 && b.x + b.width <= w && b.y + b.height <= h))
    await page.screenshot({ path: `${SHOTS}/event-editor-${w}-draft-dialog.png` })
    await page.locator('[data-draft-keep]').click(); await page.waitForTimeout(150)
    check(`${w}: Keep editing keeps the typed values`, (await page.locator('[data-draft-dialog]').count()) === 0 && (await page.locator('[data-editor-name]').inputValue()) === 'Picnic')
    await page.locator('[data-event-cancel]').click(); await page.waitForTimeout(150)
    await page.locator('[data-draft-save]').click(); await page.waitForTimeout(300)
    check(`${w}: Save draft: a Draft row in Events`, (await page.locator('[data-event-draft] [data-draft-pill]').count()) === 1 && (await store()).eventDrafts?.length === 1)
    await page.locator('[data-event-draft]').click(); await page.waitForTimeout(300)
    check(`${w}: the draft opens with its guests`, (await page.locator('[data-editor-name]').inputValue()) === 'Picnic' && (await page.locator('[data-editor-guest]').count()) === 3)
    await page.locator('[data-event-save]').click(); await page.waitForTimeout(300)
    const rec = await store()
    const made = rec.events.find((e) => e.name === 'Picnic')
    check(`${w}: Save makes the event: guests invited, Anna co-host, both conference links; the draft is gone`, made && made.people?.join() === 'b1,c1' && made.hosts?.join() === 'Tester,a1' && made.conference?.length === 2 && !rec.eventDrafts)
    check(`${w}: a used provider counts as connected next time`, rec.calendars?.rooms?.kmeet === 'https://kmeet.infomaniak.com/picnic')

    // Item 13 + 43-D5 on the event page.
    await toEvents()
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    check(`${w}: a future event says "I will attend"`, (await page.locator('[data-event-attended]').innerText()) === 'I will attend')
    const row = page.locator('[data-event-feed-toggle]')
    if (await row.count()) {
      await row.click({ button: 'right' }); await page.waitForTimeout(250)
      check(`${w}: right click / long press on the Feed row opens the Feed settings`, (await page.locator('[data-event-feed-settings]').count()) === 1)
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    } else check(`${w}: the event Feed row shows (feed offered)`, false)
    errors.length = errors.length

    // Calendars by tag.
    await page.goto(URL); await page.waitForTimeout(800)
    await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-tags]').count()) {
      await page.locator('[data-cal-tag="mine"]').click(); await page.waitForTimeout(200)
      check(`${w}: a calendar tag switched off is struck through`, (await page.locator('[data-cal-tag="mine"].tw-off[aria-pressed="false"]').count()) === 1)
      await page.locator('[data-cal-tag="mine"]').click(); await page.waitForTimeout(150)
    } else console.log(`SKIP  ${w}: calendar module off in this variation`)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
