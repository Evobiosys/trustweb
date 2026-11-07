// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b tools-rings-3 proof (headless): PORT=5470 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node tools_rings_3.mjs. Synthetic record. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5470}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const DAY = 86_400_000
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  for (const [name, opts] of [['1280', { viewport: { width: 1280, height: 900 } }], ['360', { viewport: { width: 360, height: 780 } }]]) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const mk = (id, ring, age, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - age, fields: {}, ...o })
    const people = [...Array.from({ length: 8 }, (_, i) => mk(`f${i}`, 'friend', (i + 2) * DAY)), ...Array.from({ length: 8 }, (_, i) => mk(`a${i}`, 'acquaintance', 3_600_000 * (i + 1)))]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const drawn = () => page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => n.dataset.pid).sort())
    const setM = async (n) => { await page.locator('[data-per-ring-m]').click(); await page.locator('[data-per-ring-m-input]').fill(String(n)); await page.keyboard.press('Enter'); await page.waitForTimeout(400) }

    // Rows: one line each, order, closest greyed (5 x 2 rings = 10 <= 150).
    const rows = page.locator('[data-zone-side] .zone-row')
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-zone-side] .zone-row')].map((r) => r.querySelector('[data-zone-connections],[data-per-ring],[data-closest150],[data-space-out-tools],[data-expand-buttons],[data-hidden-people],[data-recently-deleted]')?.getAttributeNames().find((a) => a.startsWith('data-'))))
    check(`${name}: row order (${order.join(',')})`, order.join() === 'data-zone-connections,data-per-ring,data-closest150,data-space-out-tools,data-expand-buttons,data-hidden-people,data-recently-deleted')
    const lines = await rows.evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height))
    check(`${name}: every row one line (heights ${lines.join('/')})`, lines.every((h) => h > 0 && h < 40))
    const clipped = await page.evaluate(() => [...document.querySelectorAll('[data-zone-side] .zone-row')].filter((r) => r.scrollWidth > r.clientWidth + 1).map((r) => r.textContent.trim().slice(0, 30) + ` ${r.scrollWidth}>${r.clientWidth}`))
    check(`${name}: no row clipped (${clipped.join('; ')})`, clipped.length === 0)
    check(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: closest row greyed with m=5`, (await page.locator('[data-closest-moot="1"][aria-disabled="true"]').count()) === 1)
    await page.locator('[data-zone-side]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/tools-rings-3-${name}-tools.png` })
    await page.locator('[data-closest-moot]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/tools-rings-3-${name}-moot.png` })
    await setM(20)
    check(`${name}: m=20 x 2 rings = 40 <= 150 -> still moot`, (await page.locator('[data-closest-moot]').count()) === 1)
    await page.locator('[data-closest-n]').click({ force: true }); await page.locator('[data-closest-n-input]').fill('30', { force: true }); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    check(`${name}: closest 30 < 40 -> row active`, (await page.locator('[data-closest-moot]').count()) === 0)
    await page.locator('[data-closest-n]').click({ force: true }); await page.locator('[data-closest-n-input]').fill('150', { force: true }); await page.keyboard.press('Enter'); await page.waitForTimeout(300)

    // m 5 -> 4 -> 6: the same people come back.
    await setM(6); const six = await drawn()
    await setM(4); const four = await drawn()
    await setM(6); const six2 = await drawn()
    check(`${name}: m=6 draws 12 dots`, six.length === 12)
    check(`${name}: m=4 draws 8 dots, all among the six`, four.length === 8 && four.every((x) => six.includes(x)))
    check(`${name}: m=6 again = the same 12`, JSON.stringify(six) === JSON.stringify(six2))
    await setM(5)

    // Drag f4 (5th friend, shown) onto the acquaintance ring (all newer): it must stay drawn.
    check(`${name}: f4 drawn before the drag`, (await drawn()).includes('f4'))
    const nb = await page.locator('.rings-wrap [data-pid="f4"]').boundingBox()
    const ring = await page.locator('.rings-wrap circle[data-ring="acquaintance"]').boundingBox()
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
    await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
    await page.mouse.move(ring.x + ring.width / 2 + 10, ring.y + 1, { steps: 10 })
    await page.mouse.up(); await page.waitForTimeout(500)
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.find((p) => p.id === 'f4').ring)
    check(`${name}: f4 now on the acquaintance ring (${rec})`, rec === 'acquaintance')
    check(`${name}: f4 still drawn after the drop`, (await drawn()).includes('f4'))
    await page.screenshot({ path: `${SHOTS}/tools-rings-3-${name}-drag-kept.png` })
    // Next press elsewhere ends the pin: the next re-cut drops it.
    await page.mouse.click(ring.x + 4, ring.y + ring.height - 4); await page.waitForTimeout(300)
    await setM(5)
    check(`${name}: after pressing elsewhere, the cut applies again (f4 gone)`, !(await drawn()).includes('f4'))

    // Preview panel: minimize above select-all (when a panel is on this build).
    const panel = await page.evaluate(() => { const x = document.querySelector('.twp header .x'); const a = [...document.querySelectorAll('.twp button')].find((b) => /Select (all|none)/.test(b.textContent ?? '')); return x && a ? [x.getBoundingClientRect().bottom <= a.getBoundingClientRect().top] : null })
    if (panel) check(`${name}: minimize above select all`, panel[0]); else console.log(`SKIP  ${name}: no preview panel on this server`)
    check(`${name}: no page errors`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
