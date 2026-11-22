// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 bar-equal-no-highlight (headless, stock dev only): PORT=5465 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node bar_equal_no_highlight.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5465}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs')
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const load = async (chats) => {
      await page.goto(URL); await page.waitForTimeout(1200)
      await page.evaluate(([k, c]) => localStorage.setItem(k, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people: [], chats: c })), [KEY, chats])
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1000)
    }
    const lead = () => page.locator('.tabs .tab-primary.tab-lead').count()
    await load({})
    check(`${w}: a raised pair with equal counts: both raised, no extra ring`, (await page.locator('.tabs.pair .tab-primary').count()) === 2 && (await lead()) === 0)
    await page.screenshot({ path: `${SHOTS}/bar-equal-no-highlight-${w}-equal.png` })
    await load({ p1: { unread: 3, messages: [{ key: 'i:5:x', dir: 'in', text: 'hi', at: 5, sentAt: 5, state: 'received' }] } })
    check(`${w}: a strict maximum (Chat 3 vs Events 0) wears the extra ring`, (await lead()) === 1 && (await page.locator('.tabs .tab-primary.tab-lead[data-go="chat"]').count()) === 1, await page.evaluate(() => [...document.querySelectorAll('.tabs > *')].map((e) => e.className + '|' + e.dataset.go).join(' ; ')))
    await page.screenshot({ path: `${SHOTS}/bar-equal-no-highlight-${w}-lead.png` })
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
