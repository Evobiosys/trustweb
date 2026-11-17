// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c item 2 (headless, stock dev server, synthetic record): PORT=5481 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<index.mjs> node answers_44c_tabs.mjs
 *  Personal: first screen = the rings, first tab "Web" opens the rings, Home sits in ⋮, Settings > Home "Open Home first" off.
 *  Community: first tab "Home", the one next to it "Web"; Web opens the rings even with Home pinned for the personal view.
 */
import { quietKeepCopy } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5481}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
quietKeepCopy(browser) // review-44c: the Keep-a-copy offer sheet covered the controls (red on base 85191dbcde)
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: 1, fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' })]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const record = (extra = {}) => ({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: [], missedPopupOff: true, demoOffered: true, ...extra })
const tabs = (page) => page.locator('.tabs > [data-go]').evaluateAll((bs) => bs.map((b) => `${b.getAttribute('data-go')}=${b.getAttribute('aria-label')}`))
async function open(w, h, rec) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.log('pageerror', String(e)); failed = true })
  await page.goto(URL); await page.waitForTimeout(900)
  await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t) }, [JSON.stringify(rec), JSON.stringify(tags)])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1000)
  await page.getByText('No thanks').click({ timeout: 1000 }).catch(() => {})
  return { ctx, page }
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    // ---- Personal view
    let { ctx, page } = await open(w, h, record())
    check(`${w}: personal: first screen is the web (rings), not the Home board`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('[data-home-board]').count()) === 0)
    let t = await tabs(page)
    check(`${w}: personal: first tab is Web ${JSON.stringify(t)}`, t[0] === 'web=Web')
    check(`${w}: personal: no Home tab in the bar`, !t.some((x) => x.startsWith('community:home')))
    await page.locator('.tabs [data-go="chat"]').click(); await page.waitForTimeout(400)
    await page.locator('.tabs [data-go="web"]').click(); await page.waitForTimeout(500)
    check(`${w}: personal: Web tab opens the rings`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('[data-home-board]').count()) === 0)
    await page.locator('[data-bar-more]').click(); await page.waitForTimeout(400)
    check(`${w}: personal: Home stays reachable in ⋮`, (await page.locator('[data-bar-home]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/answers-44c-tabs-personal-${w}.png` })
    await page.locator('[data-bar-home]').click(); await page.waitForTimeout(500)
    check(`${w}: personal: ⋮ Home opens the tile board`, (await page.locator('[data-home-board]').count()) === 1)
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    check(`${w}: personal: Settings > Home "Open Home first" is off`, (await page.locator('[data-home-start]').getAttribute('aria-checked')) === 'false')
    await ctx.close()

    // ---- Community view, with Home pinned for the personal view (opt-in)
    ;({ ctx, page } = await open(w, h, record({ uiViews: { webDefault: 'home' } })))
    check(`${w}: opt-in: personal first screen is Home`, (await page.locator('[data-home-board]').count()) === 1)
    await page.locator('[data-home-tile="web"] [data-home-thumb]').click(); await page.waitForTimeout(500)
    await page.locator('[data-mode="community"]').first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(1500)
    t = await tabs(page)
    check(`${w}: community: first tab Home, next Web ${JSON.stringify(t)}`, t[0] === 'community:home=Home' && t[1] === 'web=Web')
    await page.locator('.tabs [data-go="web"]').click(); await page.waitForTimeout(600)
    check(`${w}: community: Web opens the rings (not the Home board)`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('[data-home-board]').count()) === 0)
    await page.locator('.tabs [data-go="community:home"]').click(); await page.waitForTimeout(800)
    check(`${w}: community: Home opens the community's board`, (await page.locator('[data-community]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/answers-44c-tabs-community-${w}.png` })
    const boxes = await page.locator('.tabs > [data-go]').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return [r.x, r.width] }))
    check(`${w}: community: bar fits, no overlap`, boxes.every(([x, wd], i) => x >= 0 && x + wd <= w + 1 && (i === 0 || boxes[i - 1][0] + boxes[i - 1][1] <= x + 1)), JSON.stringify(boxes))
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
