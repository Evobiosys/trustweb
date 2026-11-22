// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 events-refetch (headless, stock dev server, synthetic record): the Events list has a Refresh button and takes a pull-down; both start the
 * re-fetch (the button reads "Looking for new events…" while it runs); the empty list has them too; no document scroll at 360x780 and 1280x900.
 * PORT=5483 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node events_refetch.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5483}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const record = (events) => ({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [{ id: 'peer-b', displayName: 'Ben' }], log: [], inventory: [], people: [P('b', 'Ben Gruber', { peerId: 'peer-b' })], events })
const EV = { id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true }
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    for (const [label, events] of [['list', [EV]], ['empty', []]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
      const page = await ctx.newPage()
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); sessionStorage.clear() }, JSON.stringify(record(events)))
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(400)
      if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
      await page.waitForTimeout(300)
      const btn = page.locator('[data-events-refetch]')
      check(`${w} ${label}: the Refresh button is there, once`, (await btn.count()) === 1 && (await btn.textContent()) === 'Refresh')
      // the click reads "Looking for new events…" synchronously, then returns to Refresh
      const looked = await page.evaluate(() => { const b = document.querySelector('[data-events-refetch]'); b.click(); return [b.textContent, b.disabled] })
      check(`${w} ${label}: a click starts the re-fetch`, looked[0] === 'Looking for new events…' && looked[1] === true, JSON.stringify(looked))
      await page.waitForTimeout(500)
      check(`${w} ${label}: the button is back afterwards`, (await btn.textContent()) === 'Refresh' && (await btn.isEnabled()))
      // a pull-down from the top of the list starts it too
      const pulled = await page.evaluate(() => {
        const sc = document.querySelector('[data-events-refetch]').closest('.scroll'); sc.scrollTop = 0
        const t = (y) => new Touch({ identifier: 1, target: sc, clientY: y, clientX: 50 })
        sc.dispatchEvent(new TouchEvent('touchstart', { touches: [t(100)], changedTouches: [t(100)], bubbles: true }))
        sc.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(220)], bubbles: true }))
        return document.querySelector('[data-events-refetch]').textContent
      })
      check(`${w} ${label}: a pull-down starts the re-fetch`, pulled === 'Looking for new events…', pulled)
      await page.waitForTimeout(500)
      const doc = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      check(`${w} ${label}: no document scroll`, doc.sh <= doc.ch + 1 && doc.sw <= doc.cw + 1, JSON.stringify(doc))
      await page.screenshot({ path: `${SHOTS}/events-refetch-${label}-${w}.png` })
      check(`${w} ${label}: no page errors`, errors.length === 0, errors.join('|'))
      await ctx.close()
    }
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
