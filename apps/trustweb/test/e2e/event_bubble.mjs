// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-bubble (headless, stock dev server, synthetic record): event mode on = the Web shows only the event's people; the chip "Everyone"
 * lifts it and puts it back; leaving event mode ends the lift; setting off = no narrowing and no chip. 360x780 and 1280x900.
 * PORT=5486 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node event_bubble.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5486}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs')
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const people = [
  { id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, events: ['e1'], peerId: 'peer-p1' },
  { id: 'p2', name: 'Cara Lenz', ring: 'close', lines: [], context: '', metAt: 1, peerId: 'peer-p2' },
]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
const record = (extra) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [EV], uiRings: { eventMode: 'e1' }, ...extra })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const dots = (page) => page.evaluate(() => [...document.querySelectorAll('.node[data-pid]')].map((n) => n.dataset.pid).sort())
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    const load = async (extra) => { await page.evaluate(([r]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [record(extra)]); await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900); await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {}) }
    await load({})
    check(`${w}: event mode on = only the event's person`, (await dots(page)).join() === 'p1', (await dots(page)).join())
    check(`${w}: chip Everyone shown`, (await page.locator('[data-event-everyone]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/event-bubble-on-${w}.png` })
    await page.locator('[data-event-everyone]').click(); await page.waitForTimeout(500)
    check(`${w}: Everyone = both people, event mode still on`, (await dots(page)).join() === 'p1,p2' && (await page.locator('[data-event-mode-pill]').count()) === 1, (await dots(page)).join())
    await page.screenshot({ path: `${SHOTS}/event-bubble-everyone-${w}.png` })
    await page.locator('[data-event-everyone]').click(); await page.waitForTimeout(500)
    check(`${w}: Everyone again = narrowed again`, (await dots(page)).join() === 'p1')
    await page.locator('[data-event-everyone]').click(); await page.waitForTimeout(400)
    await page.locator('[data-event-mode-leave]').click(); await page.waitForTimeout(400)
    check(`${w}: leaving event mode = everyone, no chip`, (await dots(page)).join() === 'p1,p2' && (await page.locator('[data-event-everyone]').count()) === 0)
    await load({ eventBubbleOff: true })
    check(`${w}: setting off = everyone and no chip while event mode is on`, (await dots(page)).join() === 'p1,p2' && (await page.locator('[data-event-everyone]').count()) === 0 && (await page.locator('[data-event-mode-pill]').count()) === 1, (await dots(page)).join())
    check(`${w}: no page errors`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
