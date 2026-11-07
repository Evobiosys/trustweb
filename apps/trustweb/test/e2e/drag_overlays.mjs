// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 drag-overlays proof (headless, dev only): PORT=5461 [SHOTS=<dir>] node test/e2e/drag_overlays.mjs (a stock dev server). */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
const people = [
  ...['Ada', 'Bo', 'Cy'].map((n, i) => P('c' + i, n + ' Close', 'close')),
  ...Array.from({ length: 6 }, (_, i) => P('f' + i, 'Fran' + i + ' Friend', 'friend')),
  ...Array.from({ length: 20 }, (_, i) => P('a' + i, 'Acq' + i + ' Person', 'acquaintance')),
]
try {
  for (const width of [360, 1280]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
    const tag = `${width}px`
    const shot = async (n) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/drag-overlays-${n}-${width}.png` }) }
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), people)
    await page.reload(); const wrap = page.locator('.rings-wrap'); await wrap.waitFor()
    await wrap.scrollIntoViewIfNeeded()
    const box = await wrap.boundingBox()
    const k = box.width / 352
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const rad = (r) => page.evaluate((x) => +document.querySelector(`.rings-wrap circle[data-ring="${x}"]`).getAttribute('r'), r)
    const rFriend = await rad('friend')
    const line = { x: c.x + rFriend * k * Math.SQRT1_2, y: c.y - rFriend * k * Math.SQRT1_2 }
    const cards = () => page.locator('[data-ring-card]').count()
    // dwell: 100 ms none, 350 ms card
    await page.mouse.move(line.x - 40, line.y + 40); await page.mouse.move(line.x, line.y, { steps: 4 })
    await page.waitForTimeout(100); check(`${tag}: no card after 100 ms`, (await cards()) === 0)
    await page.waitForTimeout(250); check(`${tag}: card after 350 ms`, (await cards()) === 1)
    await shot('card')
    await page.mouse.move(c.x, c.y + 4 + 30 * k); await page.waitForTimeout(500)
    check(`${tag}: card closes after leaving`, (await cards()) === 0)
    // leaving before 300 ms cancels
    await page.mouse.move(line.x, line.y, { steps: 3 }); await page.waitForTimeout(100)
    await page.mouse.move(c.x - 20 * k, c.y - 20 * k); await page.waitForTimeout(500)
    check(`${tag}: left before 300 ms -> no card`, (await cards()) === 0)
    // drag a dot: no card, zone title at the top of the acquaintance ring
    const dot = await page.locator('.rings-wrap [data-pid="f0"]').boundingBox()
    const from = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }
    const rAcq = await rad('acquaintance')
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(c.x, c.y - rAcq * k, { steps: 8 }); await page.waitForTimeout(500)
    check(`${tag}: dragging: no card`, (await cards()) === 0)
    const title = page.locator('[data-zone-title="acquaintance"]')
    check(`${tag}: zone title shown`, (await title.count()) === 1 && (await title.isVisible()) && /Acquaintances/.test(await title.textContent()))
    await shot('drag')
    await page.mouse.move(line.x, line.y, { steps: 4 }); await page.waitForTimeout(450)
    check(`${tag}: dragging over a line, 450 ms: no card`, (await cards()) === 0)
    await page.mouse.up(); await page.waitForTimeout(400)
    check(`${tag}: title gone after drop`, (await page.locator('[data-zone-title]').count()) === 0)
    check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
