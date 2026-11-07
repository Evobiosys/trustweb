// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 ring-rule proof (headless): PORT=5480 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node ring_rule.mjs. Synthetic record, stock mode. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5480}/`
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
    const mk = (id, ring, age) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - age, fields: {} })
    const people = [...Array.from({ length: 8 }, (_, i) => mk(`f${i}`, 'friend', (i + 2) * DAY)), ...Array.from({ length: 8 }, (_, i) => mk(`a${i}`, 'acquaintance', 3_600_000 * (i + 1)))]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const drawn = () => page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => n.dataset.pid).sort())
    const ringOf = (id) => page.evaluate((i) => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.find((p) => p.id === i).ring, id)
    const drag = async (id, ringName) => {
      const nb = await page.locator(`.rings-wrap [data-pid="${id}"]`).boundingBox()
      const ring = await page.locator(`.rings-wrap circle[data-ring="${ringName}"]`).boundingBox()
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
      await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
      await page.mouse.move(ring.x + ring.width / 2 + 10, ring.y + 1, { steps: 10 })
      await page.mouse.up(); await page.waitForTimeout(500)
    }
    const box = page.locator('[data-rings-auto-adjust]')
    check(`${name}: setting exists, default off`, (await box.count()) === 1 && !(await box.isChecked()))
    await box.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/ring-rule-${name}-tools.png` })
    check(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))

    const before = await drawn()
    check(`${name}: f4 drawn, f5 not (5 per ring)`, before.includes('f4') && !before.includes('f5') && before.length === 10)
    await drag('f4', 'acquaintance')
    check(`${name}: f4 now on the acquaintance ring`, (await ringOf('f4')) === 'acquaintance')
    const after = await drawn()
    check(`${name}: off: dot set unchanged (same 10, f4 still drawn, nothing else in/out)`, JSON.stringify(after) === JSON.stringify(before))
    await page.screenshot({ path: `${SHOTS}/ring-rule-${name}-off-after-drag.png` })
    await page.waitForTimeout(1500)
    check(`${name}: off: still unchanged after 1.5 s`, JSON.stringify(await drawn()) === JSON.stringify(before))

    // On: the recent-N rule re-applies slowly.
    await box.check(); await page.waitForTimeout(300)
    await drag('f3', 'acquaintance')
    const mid = await drawn()
    check(`${name}: on: leaving dot still drawn while it fades`, mid.includes('f3'))
    check(`${name}: on: fade classes present right after the drop`, (await page.locator('.node.fade-in, .node.fade-out').count()) > 0)
    await page.screenshot({ path: `${SHOTS}/ring-rule-${name}-on-fading.png` })
    await page.waitForTimeout(2200)
    const fin = await drawn()
    check(`${name}: on: friend ring refilled (f5 appears)`, fin.includes('f5'))
    check(`${name}: on: no fading dots left`, (await page.locator('.node.fade-in, .node.fade-out').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/ring-rule-${name}-on-settled.png` })
    check(`${name}: no page errors`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
