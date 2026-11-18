// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker-4 (headless, stock dev only): "+ tag" picker adds an existing or a new tag, placement pills fit at 360 and 1280, QR is an SVG symbol.
 *  PORT=5294 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node steer_people_picker_4.mjs */
import { quietKeepCopy } from './rings_first.mjs'
const pwm = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const pw = pwm.chromium ? pwm : pwm.default
const ORIGIN = `http://127.0.0.1:${process.env.PORT ?? 5294}`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await pw.chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
quietKeepCopy(browser) // review-44c: the Keep-a-copy offer sheet (its veil) covered the controls (red on base 85191dbcde)
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, extra = {}) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields: {}, ...extra })
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'LNlpliq4GdNI', colour: '#7b1fa2', label: 'family' }]
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const tagList = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.colourtags')))
const inside = (a, b) => a && b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1
try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const people = [person('p1', 'Ben Gruber', 'close', { fields: { iyg: 'true' } })]
    const events = [{ id: 'e1', name: 'Spring meetup', from: '2026-12-01T18:00', where: 'Wien', organizers: [] }]
    const rec = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events, extData: { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: [] } } } } }
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.setDefaultTimeout(8000)
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(ORIGIN + '/'); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(rec), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    const shot = (n) => page.screenshot({ path: `${SHOTS}/steer-people-picker-4-${vw}-${n}.png` })

    // 1. "+ tag" on the card
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    if (await page.locator('[data-community-menu]').isVisible()) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-community-nav="members"]').click(); await page.waitForTimeout(500)
    await page.locator('[data-community-member="p1"]').click(); await page.waitForTimeout(700)
    await page.locator('[data-tag-add]').click(); await page.waitForTimeout(300)
    const pick = page.locator('[data-tag-pick]')
    check(`${vw}: + tag opens the picker`, await pick.isVisible())
    check(`${vw}: picker lists the existing tag and a name box`, (await page.locator('[data-tag-choice="LNlpliq4GdNI"]').count()) === 1 && await page.locator('[data-tag-new]').isVisible())
    check(`${vw}: the picker sits inside the phone, clear of the tag row`, inside(await pick.boundingBox(), { x: 0, y: 0, width: vp.width, height: vp.height }))
    await shot('1-picker')
    await page.locator('[data-tag-choice="LNlpliq4GdNI"]').click(); await page.waitForTimeout(500)
    check(`${vw}: an existing tag chip adds it`, (await store(page)).people[0].fields.LNlpliq4GdNI !== undefined && /family/.test(await page.locator('[data-card-tags]').innerText()))
    await page.locator('[data-tag-add]').click(); await page.waitForTimeout(200)
    await page.locator('[data-tag-new]').fill('Choir'); await page.locator('[data-tag-new]').press('Enter'); await page.waitForTimeout(600)
    check(`${vw}: a new name defines the tag and adds it`, (await tagList(page)).some((t) => t.label === 'Choir') && /Choir/.test(await page.locator('[data-card-tags]').innerText()))
    await shot('1-tagged')

    // 2. placement pills + 3. QR symbol on the event share row
    await page.goto(ORIGIN + '/'); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    await page.locator('.status-pill.qr').click(); await page.locator('[data-connect-placement]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(1200)
    const row = page.locator('[data-connect-placement]')
    check(`${vw}: placement is segmented pills, not a native select`, (await page.locator('select[data-connect-placement]').count()) === 0 && await row.evaluate((e) => e.classList.contains('seg')))
    const boxes = await page.locator('[data-connect-placement] button').evaluateAll((b) => b.map((x) => { const r = x.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    check(`${vw}: four pills inside the viewport width`, boxes.length === 4 && boxes.every((b) => b.x >= 0 && b.x + b.width <= vp.width + 1), JSON.stringify(boxes))
    const scan = await page.locator('[data-scan-code]').boundingBox(), rb = await row.boundingBox()
    check(`${vw}: pills do not overlap the Scan button`, !(rb.y < scan.y + scan.height && scan.y < rb.y + rb.height), JSON.stringify({ rb, scan }))
    await page.locator('[data-connect-placement] [data-ring="friend"]').click(); await page.waitForTimeout(200)
    check(`${vw}: choosing a pill stores the zone`, (await store(page)).connectPlacement === 'friend' && (await page.locator('[data-connect-placement] .on').getAttribute('data-ring')) === 'friend')
    await shot('2-placement')
    check(`${vw}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 3. QR symbol on the event share row
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  await page.goto(ORIGIN + '/'); await page.waitForTimeout(900)
  const day = new Date().toISOString().slice(0, 10)
  const rec = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [], events: [{ id: 'e1', name: 'Spring meetup', from: day + 'T09:30', where: 'Wien', createdAt: 1, attended: true }] }
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r) }, JSON.stringify(rec)); await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
  await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
  await page.locator('[data-cal-all]').first().click(); await page.waitForTimeout(200)
  await page.locator('[data-event="e1"]').first().click(); await page.waitForTimeout(400)
  const qr = page.locator('[data-event-qr]').first()
  if (await qr.count()) {
    check('QR share button holds an SVG, no text glyph', (await qr.locator('svg').count()) === 1 && !(await qr.innerText()).includes('▦'))
    await page.screenshot({ path: `${SHOTS}/steer-people-picker-4-qr.png` })
  } else check('event page reachable for the QR check', false, 'no [data-event-qr]')
  await ctx.close()
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS'); process.exit(failed ? 1 : 0)
