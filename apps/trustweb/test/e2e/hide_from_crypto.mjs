// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto (headless, stock dev only): Ask > Hide from shows the lock line "Friends relay this list sealed" when the ask
 * travels (reach >= 2), not for direct contacts only; it overlaps nothing (P06) at 360x780 and 1280x900. The wire (tamper mid-hop, honest
 * path, the hidden person never asked) is covered with real Nets in test/unit/hide_from_net.test.mjs.
 * PORT=5454 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node hide_from_crypto.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5454}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const peer = (id, name) => ({ id, displayName: name, did: 'did:test:' + id, ring: 'friend', connectedAt: 1 })
const P = (id, name, ring) => ({ id: 'p-' + id, name, context: '', ring, metAt: 1, lines: [], fields: {}, peerId: id })
const PEOPLE = [P('cy', 'Cy Stone', 'closest'), P('di', 'Di Moss', 'close'), P('ed', 'Ed Park', 'friend')]
const rect = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })
const apart = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    const seed = (reach) => page.evaluate(([ppl, peers, r]) => {
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers, log: [], inventory: [], events: [], askAudience: { add: [], exclude: ['person:p-di'] }, ...(r ? { askReach: r } : {}) }))
    }, [PEOPLE, PEOPLE.map((p) => peer(p.peerId, p.name)), reach])
    const openAsk = async () => {
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
      await page.locator('[data-open-query]:visible').first().click(); await page.waitForTimeout(400)
    }

    await seed(2); await openAsk()
    check(`${w}: the Hide from row holds the chip`, (await page.locator('[data-aud-chips="exclude"] [data-aud-chip="person:p-di"]').count()) === 1)
    const line = page.locator('[data-hide-sealed]')
    check(`${w}: reach 2: the lock line shows under Hide from`, (await line.count()) === 1 && (await line.isVisible()))
    const text = (await line.count()) ? await line.innerText() : ''
    check(`${w}: lock glyph + "Friends relay this list sealed; they cannot read or edit it"`, text.includes('🔒') && text.includes('Friends relay this list sealed; they cannot read or edit it'), text)
    if (await line.count()) {
      const r = await rect(page, '[data-hide-sealed]')
      check(`${w}: P06 the lock line overlaps neither the Hide from box nor the travel hint`, apart(r, await rect(page, '[data-aud-input="exclude"]')) && apart(r, await rect(page, '[data-aud-hide-travels]')))
      check(`${w}: the lock line stays inside the viewport`, r.l >= 0 && r.r <= w + 0.5, JSON.stringify(r))
    }
    await page.screenshot({ path: `${SHOTS}/hide-from-crypto-sealed-${w}.png` })

    await seed(null); await openAsk()
    check(`${w}: direct contacts only: no lock line (nothing travels)`, (await page.locator('[data-hide-sealed]').count()) === 0)
    check(`${w}: no document scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
