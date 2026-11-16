// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker (headless, stock dev only): "+" on Members opens the people I know (no AI page), pick = tag, "Add a new person" opens the Add view with the tag, tile = card, card QR bound to this person.
 *  PORT=5294 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node steer_people_picker.mjs */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5294}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields = {}) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend'), person('p3', 'Dan Huber', 'acquaintance')]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }]
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [], extData: { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: [] } } } } }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const shot = (n) => page.screenshot({ path: `${SHOTS}/steer-people-picker-${vw}-${n}.png` })
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(record), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    if (await page.locator('[data-community-menu]').isVisible()) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-community-nav="members"]').click(); await page.waitForTimeout(400)

    // 1. "+" opens the picker, not the AI plan page
    await page.locator('[data-community-add-member]').click(); await page.waitForTimeout(500)
    check(`${vw}: + opens the people picker`, (await page.locator('[data-member-search]').count()) === 1)
    check(`${vw}: no AI plan page, no assistant toast`, (await page.locator('[data-ai-signup]').count()) === 0 && !/assistant/i.test(await page.locator('body').innerText()))
    const offered = await page.locator('[data-member-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-member-pick')))
    check(`${vw}: lists the people I know that are not members yet`, JSON.stringify(offered.sort()) === JSON.stringify(['p2', 'p3']), offered.join(','))
    const pick = await page.locator('[data-member-pick="p2"]').boundingBox(); const addNew = await page.locator('[data-member-add-new]').boundingBox()
    check(`${vw}: "Add a new person" sits below the list`, pick && addNew && addNew.y > pick.y)
    await shot('1-picker')
    await page.locator('[data-member-search]').fill('@dan'); await page.waitForTimeout(150)
    check(`${vw}: type-to-select filters`, (await page.locator('[data-member-pick]').count()) === 1)
    await page.locator('[data-member-pick="p3"]').click(); await page.waitForTimeout(500)
    check(`${vw}: pick gives the person the community tag`, (await store()).people.find((p) => p.id === 'p3').fields.iyg === 'true')
    check(`${vw}: Members grid now shows the person`, (await page.locator('[data-community-member="p3"]').count()) === 1)

    // 2. add a new person: the Add view opens with the tag preset
    await page.locator('[data-community-add-member]').click(); await page.waitForTimeout(400)
    await page.locator('[data-member-add-new]').click(); await page.waitForTimeout(400)
    check(`${vw}: Add a new person opens the Add-someone view`, (await page.locator('[data-add-person]').count()) === 1)
    await page.locator('input[aria-label]').first().fill('Eva Neu'); await page.locator('[data-add-person]').click(); await page.waitForTimeout(600)
    const eva = (await store()).people.find((p) => p.name === 'Eva Neu')
    check(`${vw}: the new person carries the tag`, eva?.fields?.iyg === 'true')
    await page.waitForTimeout(300)
    check(`${vw}: Members grid shows the new person`, (await page.locator('[data-community-member]').count()) === 3)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // 3. tile -> card
    await page.locator('button.tab[data-go="mod:community"]').click().catch(() => {}); await page.waitForTimeout(500)
    if (await page.locator('[data-community-menu]').isVisible().catch(() => false)) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-community-nav="members"]').click().catch(() => {}); await page.waitForTimeout(400)
    await page.locator('[data-community-member="p1"]').click(); await page.waitForTimeout(700)
    check(`${vw}: tapping the tile opens the person's card`, (await page.locator('[data-card-qr="p1"]').count()) >= 1)
    await shot('2-card')

    // 4. card QR bound to this person
    await page.locator('[data-card-qr="p1"]').first().click(); await page.waitForTimeout(900)
    const payload = await page.locator('[data-qr-modes]').getAttribute('data-payload')
    check(`${vw}: QR payload carries this person`, /[#&]to=p1(&|$)/.test(payload ?? ''), payload)
    check(`${vw}: title "Connect with Ben Gruber"`, (await page.locator('[data-qr-title]').innerText()) === 'Connect with Ben Gruber')
    await shot('3-qr')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    check(`${vw}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${vw}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
