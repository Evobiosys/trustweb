// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 rings-controls proof (headless): PORT=5461 EXE=<chromium> PW=<playwright-core index.mjs> node rings_controls.mjs. Synthetic record. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  for (const [name, opts] of [['1280', { viewport: { width: 1280, height: 900 } }], ['360', { viewport: { width: 360, height: 780 } }]]) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 86_400_000, fields: {}, ...o })
    const people = [...Array.from({ length: 9 }, (_, i) => mk(`f${i}`, 'friend')), ...Array.from({ length: 8 }, (_, i) => mk(`a${i}`, 'acquaintance'))]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)

    check(`${name}: exactly one bottom row`, (await page.locator('[data-expand-row]').count()) === 1)
    check(`${name}: no ⛶ control outside the row`, (await page.locator('.ring-more:not([data-expand-row] *), [data-expanse-drop]:not([data-expand-row] *), [data-zone-side] [data-expand]').count()) === 0)
    check(`${name}: row holds expand all, expanse control, one ⛶ per ring with a rest (2)`, (await page.locator('[data-expand-row] [data-expand]').count()) === 1 && (await page.locator('[data-expand-row] [data-expanse-drop]').count()) === 1 && (await page.locator('[data-expand-row] .ring-more').count()) === 2)
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    check(`${name}: no horizontal scrolling`, hscroll)
    const inside = await page.evaluate(() => [...document.querySelectorAll('[data-expand-row] button')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth })) 
    check(`${name}: every control inside the viewport`, inside)
    check(`${name}: no count badge`, (await page.locator('.expanse-count').count()) === 0)
    const px = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => parseFloat(n.style.getPropertyValue('--d')))))
    check(`${name}: dots at most 42 px, a lone-ish ring at 42`, px <= 42 && px >= 40)

    const targets = ['[data-expand-row] [data-expanse-drop]', '[data-expand-row] .ring-more >> nth=0', '[data-expand-row] .ring-more >> nth=1']
    for (const [i, sel] of targets.entries()) {
      const node = page.locator('.rings-wrap .node:not(.you)').first()
      const nb = await node.boundingBox()
      const cx = nb.x + nb.width / 2, cy = nb.y + nb.height / 2
      const pid = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.node')?.dataset.pid, [cx, cy]) // the topmost dot there
      await page.mouse.move(cx, cy); await page.mouse.down()
      const tb = await page.locator(sel).boundingBox()
      await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
      check(`${name}: control ${i} shows .drop while hovered`, await page.locator(sel).evaluate((e) => e.classList.contains('drop')))
      await page.mouse.up(); await page.waitForTimeout(500)
      check(`${name}: drop on control ${i} hides ${pid}`, (await page.locator(`.rings-wrap [data-pid="${pid}"]`).count()) === 0)
    }
    await page.locator('[data-expanse-drop]').click(); await page.waitForTimeout(300)
    check(`${name}: sheet lists 3 hidden, count only inside the sheet`, (await page.locator('[data-expanse-restore-one]').count()) === 3 && (await page.locator('[data-expanse-count="3"]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    await page.screenshot({ path: `/tmp/rings_controls_${name}.png` })
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
