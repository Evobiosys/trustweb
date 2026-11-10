// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 extensions-profiles proof (headless): PORT=5431 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node extensions_profiles.mjs. Synthetic record. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const RINGS = ['closest', 'close', 'friend', 'acquaintance']
const people = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, ring: RINGS[i % 4], lines: [], context: '', metAt: Date.now() - i * 86_400_000, fields: {}, peerId: `peer${i}` }))
const peers = people.map((p) => ({ id: p.peerId, displayName: p.name }))
const hide = '.twf, .twf-ok, .twp { display: none !important }'
try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers, log: [], inventory: [], people }))
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    check(`${name}: Resources is in the bottom bar at first`, (await page.locator('button.tab[data-go="inventory"]').count()) === 1)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    const first = await page.locator('[data-settings-group]').first().getAttribute('data-settings-group')
    check(`${name}: Settings starts with Variations`, first === 'variations')
    const head = await page.locator('[data-settings-group="variations"] summary').first().innerText()
    check(`${name}: Variations heading carries the alpha subscript`, /Variations/.test(head) && /untested alpha feature/.test(head))
    check(`${name}: variation rows Dex, Full, IYG, Reader, Note taker`, (await page.locator('[data-variation]').count()) === 5)
    check(`${name}: Full TrustWeb marked current`, (await page.locator('[data-variation="full"]').getAttribute('aria-checked')) === 'true')
    check(`${name}: variation labels underlined`, (await page.locator('[data-variation="iyg-support"] b').evaluate((b) => getComputedStyle(b).textDecorationLine)) === 'underline')
    await page.screenshot({ path: `${SHOTS}/extensions-profiles-${name}-1-settings-variations.png` })
    await page.locator('[data-settings-search]').fill('dex'); await page.waitForTimeout(300)
    check(`${name}: search "dex" finds the Dex variation`, await page.locator('[data-variation="dex"]').isVisible())
    await page.locator('[data-settings-search]').fill(''); await page.waitForTimeout(200)
    await page.locator('[data-variation="iyg-support"]').click(); await page.waitForTimeout(700)
    check(`${name}: IYG marked current`, (await page.locator('[data-variation="iyg-support"]').getAttribute('aria-checked')) === 'true')
    // Extensions under General
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"]')
    await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
    const extHead = await ext.locator('summary').first().innerText()
    check(`${name}: Extensions heading carries the alpha subscript`, /Extensions/.test(extHead) && /untested alpha feature/.test(extHead))
    check(`${name}: one switch per module (19: twelve app parts + Community, Photos, Timeline, Events map, MCP & agents, Assistant, Docs & chat)`, (await page.locator('[data-ext-module]').count()) === 19)
    check(`${name}: events, resources, feed, matches are off under IYG`, (await Promise.all(['events', 'resources', 'feed', 'matches'].map((m) => page.locator(`[data-ext-module="${m}"]`).getAttribute('aria-checked')))).every((v) => v === 'false'))
    await ext.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/extensions-profiles-${name}-2-extensions.png` })
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    check(`${name}: IYG: Resources gone from the bottom bar`, (await page.locator('button.tab[data-go="inventory"]').count()) === 0)
    check(`${name}: IYG: Events gone from the bottom bar`, (await page.locator('button.tab[data-go="events"]').count()) === 0)
    check(`${name}: IYG: Ask for support is the primary button on Web`, (await page.locator('[data-support-primary]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/extensions-profiles-${name}-3-iyg-web.png` })
    await page.locator('[data-support-primary]').click(); await page.waitForTimeout(600)
    check(`${name}: support form opens with one audience dropdown`, (await page.locator('.support-sheet select').count()) === 1 && (await page.locator('[data-support-zone]').count()) === 1)
    check(`${name}: "Closest few always" chip shown`, await page.locator('[data-support-closest-always]').isVisible())
    check(`${name}: no old ring chips`, (await page.locator('[data-support-ring]').count()) === 0)
    const n0 = Number(await page.locator('[data-support-count]').getAttribute('data-support-count'))
    await page.locator('[data-support-zone]').selectOption('ring:friend'); await page.waitForTimeout(300)
    const n1 = Number(await page.locator('[data-support-count]').getAttribute('data-support-count'))
    check(`${name}: a wider zone reaches more (${n0} -> ${n1})`, n1 > n0)
    await page.locator('[data-support-find]').fill('Person 2'); await page.waitForTimeout(300)
    await page.locator('[data-support-exclude]').first().click(); await page.waitForTimeout(300)
    check(`${name}: leaving a person out lowers the count`, Number(await page.locator('[data-support-count]').getAttribute('data-support-count')) === n1 - 1)
    await page.locator('[data-support-advanced] summary').click(); await page.locator('[data-support-not-closest]').check(); await page.waitForTimeout(300)
    check(`${name}: "Not Closest few" removes the fixed chip`, (await page.locator('[data-support-closest-always]').count()) === 0)
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${SHOTS}/extensions-profiles-${name}-4-support-audience.png` })
    await page.keyboard.press('Escape')
    // back to Full
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-variation="full"]').click(); await page.waitForTimeout(600)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check(`${name}: back to Full: Resources returns`, (await page.locator('button.tab[data-go="inventory"]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
