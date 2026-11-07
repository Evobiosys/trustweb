// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 35 views-pin-default proof (headless, dev only): PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node views_pin.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = (extra = {}) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000 }], ...extra })
try {
  for (const [name, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { viewport: { width: 1280, height: 900 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const tap = (sel) => (name === '360' ? page.locator(sel).tap() : page.locator(sel).click())
    const boot = async (extra) => {
      await page.goto(URL); await page.waitForTimeout(1200)
      await page.evaluate((r) => { localStorage.clear(); localStorage.setItem('trustweb.v1.me', r) }, record(extra))
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    }
    await boot()
    check(`${name}: Web tab reads "Web"`, (await page.locator('.tabs [data-go="web"]').innerText()).trim() === 'Web')
    await tap('.view-menu-btn'); await page.waitForTimeout(300)
    check(`${name}: every view has a ⋮`, (await page.locator('[data-view-drop] [data-view-more]').count()) >= 3)
    await tap('[data-view-more="network"]'); await page.waitForTimeout(200)
    check(`${name}: pin item shown`, (await page.locator('[data-view-pin="network"]').isVisible()))
    check(`${name}: no "Also show" in simple mode`, (await page.locator('[data-view-in-bar]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/views-pin-default-${name}-menu.png` })
    await tap('[data-view-pin="network"]'); await page.waitForTimeout(300)
    check(`${name}: tab label becomes Network`, (await page.locator('.tabs [data-go="web"]').innerText()).trim() === 'Network')
    check(`${name}: tab aria-label too`, (await page.locator('.tabs [data-go="web"]').getAttribute('aria-label')) === 'Network')
    await tap('.view-menu-btn'); await tap('[data-view-drop] [data-view="rings"]'); await page.waitForTimeout(300)
    await tap('.tabs [data-go="web"]'); await page.waitForTimeout(500)
    check(`${name}: tapping the tab opens the Network view`, (await page.locator('.web-view').innerText()).trim() === 'Network')
    await tap('.view-menu-btn'); await tap('[data-view-more="network"]')
    check(`${name}: pinned shows ✓ and is disabled`, await page.locator('[data-view-pin="network"]').isDisabled())
    await page.screenshot({ path: `${SHOTS}/views-pin-default-${name}-pinned.png` })
    // advanced on
    await boot({ uiPins: { views: [], header: ['advanced'] } })
    await tap('.view-menu-btn'); await tap('[data-view-more="map"]'); await page.waitForTimeout(200)
    check(`${name}: advanced shows "Also show in the bottom row"`, await page.locator('[data-view-in-bar="map"]').isVisible())
    await page.locator('[data-view-in-bar="map"] input').check(); await page.waitForTimeout(300)
    check(`${name}: bar entry view:map appears`, (await page.locator('.tabs [data-go="view:map"]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/views-pin-default-${name}-advanced.png` })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
