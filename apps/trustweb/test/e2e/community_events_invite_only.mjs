// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 community-events-invite-only (headless, stock dev server, synthetic record): the community settings carry "Events: only people I invite";
 * switching it on stores eventAccess 'invited' on the community, off stores 'members'; it fits 360x780 and 1280x900.
 * PORT=5481 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node community_events_invite_only.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5481}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: 1, fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Dan Huber', 'acquaintance', {})]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: [], extData, twSettings: { extensions: { 'community-mighty': true, 'community-mode': true } } })
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    if (w < 900) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
    await page.locator('[data-community-settings]').click(); await page.waitForTimeout(300)
    const toggle = page.locator('[data-community-events-invited-toggle]')
    const meta = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))).extData['community-mighty'].meta.iyg
    check(`${w}: the switch is there and starts off`, (await toggle.count()) === 1 && (await toggle.getAttribute('aria-checked')) === 'false')
    await toggle.click(); await page.waitForTimeout(300)
    check(`${w}: on stores eventAccess invited`, (await meta()).eventAccess === 'invited')
    check(`${w}: the switch reads on`, (await page.locator('[data-community-events-invited-toggle]').getAttribute('aria-checked')) === 'true')
    const box = await page.locator('[data-community-events-invited-toggle]').locator('xpath=..').boundingBox()
    check(`${w}: the label fits the view`, !!box && box.x >= 0 && box.x + box.width <= w + 1, JSON.stringify(box))
    await page.screenshot({ path: `${SHOTS}/community-events-invite-only-${w}.png` })
    await page.locator('[data-community-events-invited-toggle]').click(); await page.waitForTimeout(300)
    check(`${w}: off stores eventAccess members`, (await meta()).eventAccess === 'members')
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
