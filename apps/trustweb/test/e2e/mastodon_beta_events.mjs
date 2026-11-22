// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 mastodon-beta-events (headless, stock dev only): the Mastodon instance of an event lives in Settings > Events > Beta features, not in the event's Advanced box. PORT=5569 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node mastodon_beta_events.mjs */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5569}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs')
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, hosts: ['Tester'] }
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((ev) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [], peers: [], log: [], inventory: [], events: [ev] })), EV)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    // the event's Advanced box no longer has the field
    await page.locator('.tabs [data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) }
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(300)
    if (!(await page.locator('[data-event-advanced]').evaluate((n) => n.open))) await page.locator('[data-event-advanced] summary').click()
    check(`${w}: the event's Advanced box has no Mastodon field`, (await page.locator('[data-event-advanced]').count()) === 1 && (await page.locator('[data-event-advanced] [data-event-mastodon]').count()) === 0)
    // Settings > Features
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    const adv = page.locator('details[data-settings-group="advanced-all"]')
    if (!(await adv.evaluate((n) => n.open))) await adv.locator(':scope > summary').click()
    const grp = page.locator('details[data-settings-group="events"]')
    if (!(await grp.evaluate((n) => n.open))) await grp.locator(':scope > summary').click()
    const sec = grp.locator('[data-settings-section="events-beta"]')
    if (!(await sec.evaluate((n) => n.open))) await sec.locator('summary').click()
    await page.waitForTimeout(200)
    check(`${w}: Settings > Events > Beta features lists my event`, (await sec.locator('[data-events-beta]').count()) === 1 && (await sec.locator('[data-event-mastodon="e1"]').count()) === 1)
    const mast = sec.locator('[data-event-mastodon="e1"]')
    await mast.fill('not a host'); await mast.dispatchEvent('change'); await page.waitForTimeout(200)
    check(`${w}: a bad host shows a line and stores nothing`, (await sec.locator('[data-event-mastodon-bad="e1"]').isVisible()) && !(await store()).events[0].mastodonInstance)
    await mast.fill('Mastodon.Social'); await mast.dispatchEvent('change'); await page.waitForTimeout(200)
    check(`${w}: a good host is stored lower-case`, (await store()).events[0].mastodonInstance === 'mastodon.social' && !(await sec.locator('[data-event-mastodon-bad="e1"]').isVisible()))
    await mast.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/mastodon-beta-events-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
