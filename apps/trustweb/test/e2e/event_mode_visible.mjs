// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-mode-visible (headless, stock dev server, synthetic record): event mode on = header tint + note chip + bottom bar tint in the event colour;
 * leaving the mode (pill X) = all three gone. 360x780 and 1280x900. PORT=5464 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node event_mode_visible.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5464}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs')
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const people = [{ id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, events: ['e1'], peerId: 'peer-p1' }]
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
const record = (mode) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [EV], ...(mode ? { uiRings: { eventMode: 'e1' } } : {}) })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const look = (page) => page.evaluate(() => {
  const bg = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).backgroundColor : null }
  return { mark: document.body.dataset.twEventMode ?? null, hdr: bg('.hdr'), tabs: bg('.tabs'), note: document.querySelector('[data-event-mode-header-note]')?.textContent ?? null }
})
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    const load = async (mode) => { await page.evaluate(([r]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [record(mode)]); await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900); await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {}) }
    await load(false)
    const off = await look(page)
    check(`${w}: off = normal (no mark, no chip)`, off.mark === null && off.note === null)
    await load(true)
    const on = await look(page)
    check(`${w}: on = body marked with the event`, on.mark === 'e1')
    check(`${w}: on = header tinted`, on.hdr !== off.hdr, `${off.hdr} -> ${on.hdr}`)
    check(`${w}: on = bottom bar tinted`, on.tabs !== off.tabs, `${off.tabs} -> ${on.tabs}`)
    check(`${w}: on = note chip in the header`, on.note === '#event:Winter IYG', String(on.note))
    await page.screenshot({ path: `${SHOTS}/event-mode-visible-on-${w}.png` })
    await page.locator('[data-event-mode-leave]').click(); await page.waitForTimeout(400)
    const after = await look(page)
    check(`${w}: leaving restores header, bottom bar, chip`, after.mark === null && after.note === null && after.hdr === off.hdr && after.tabs === off.tabs, JSON.stringify(after))
    check(`${w}: no page errors`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
