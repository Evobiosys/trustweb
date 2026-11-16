// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-strike-mode proof (headless, stock dev server): PORT=5309 SHOTS=<dir> PW=<playwright-core index.mjs> EXE=<chromium headless shell> node bw_mode.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5309}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const it = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1, ...over })
const record = (over = {}) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], events: [], people: [],
  inventory: [it('i1', 'Cosmos', { kind: 'book' }), it('i3', 'Talk', { kind: 'recording', link: 'https://example.org/a' })], ...over })
const line = (page, sel) => page.locator(sel).evaluate((n) => getComputedStyle(n).textDecorationLine)
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const open = async (page, rec) => {
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), rec)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
}
const offChip = async (page) => { await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(400); await page.locator('[data-rv-filters-toggle]').click(); await page.waitForTimeout(200); return '[data-rv-kind="recording"]' }
try {
  for (const [name, opts] of [['phone', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await open(page, record())
    let sel = await offChip(page)
    check(`${name}: default: OFF chip is dimmed, no line`, (await page.locator(sel).getAttribute('aria-pressed')) === 'false' && !(await line(page, sel)).includes('line-through') && (await page.locator(sel).evaluate((n) => getComputedStyle(n).opacity)) !== '1')
    await page.screenshot({ path: `${SHOTS}/steer-strike-mode-${name}-default.png` })
    // turn the mode on in Settings > Variations
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-settings-group="advanced-all"] > summary').click(); await page.waitForTimeout(300)
    await page.evaluate(() => document.querySelector('[data-variation-bw]').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300)
    const sw = page.locator('[data-variation-bw]')
    await sw.scrollIntoViewIfNeeded()
    check(`${name}: Variations has the Black and white mode switch, off`, (await sw.count()) === 1 && (await sw.getAttribute('aria-pressed')) === 'false')
    await sw.click(); await page.waitForTimeout(400)
    check(`${name}: switch on, stored as bwMode`, (await page.locator('[data-variation-bw]').getAttribute('aria-pressed')) === 'true' && (await stored(page)).bwMode === true)
    await page.keyboard.press('Escape'); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    sel = await offChip(page)
    check(`${name}: mode on: OFF chip struck through, aria-pressed stays false`, (await line(page, sel)).includes('line-through') && (await page.locator(sel).getAttribute('aria-pressed')) === 'false')
    await page.screenshot({ path: `${SHOTS}/steer-strike-mode-${name}-on.png` })
    // migration: the event-visibility key
    const p2 = await (await browser.newContext(opts)).newPage()
    await open(p2, record({ strikeSwitchedOff: true }))
    const st = await stored(p2)
    check(`${name}: old strikeSwitchedOff migrated to bwMode`, st.bwMode === true && !('strikeSwitchedOff' in st))
    check(`${name}: no page errors`, errors.length === 0)
    check(`${name}: no document scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
  }
} catch (e) { console.log('ERROR', e); failed = true }
await browser.close()
process.exit(failed ? 1 : 0)
