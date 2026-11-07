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

    const col = await page.evaluate(() => {
      const w = document.querySelector('.rings-wrap').getBoundingClientRect(), z = 352 / w.width // the view may be zoomed: measure in the wrap's own px
      return [...document.querySelectorAll('.rings-wrap [data-expanse-drop], .rings-wrap .ring-more')].map((e) => { const r = e.getBoundingClientRect(); return { x: (r.x + r.width / 2 - w.x) * z, y: (r.y + r.height / 2 - w.y) * z, w: Math.round(r.width * z), h: 352 } })
    })
    check(`${name}: 3 controls (expanse + 2 rings with a rest), all in the rings`, col.length === 3)
    check(`${name}: ONE column: same x`, col.every((c) => Math.abs(c.x - col[0].x) < 1))
    const ys = col.map((c) => c.y).sort((p, q) => q - p)
    check(`${name}: bottom-anchored, expanse lowest, within 20 px of the bottom edge`, Math.abs(col[0].y - ys[0]) < 1 && col[0].h - ys[0] < 20)
    check(`${name}: evenly stacked upward (20 px pitch)`, ys.slice(1).every((y, i) => Math.abs(ys[i] - y - 20) < 1.5))
    check(`${name}: controls are 16 px`, col.every((c) => c.w === 16))
    check(`${name}: expand all back in the sidebar`, (await page.locator('[data-zone-side] [data-expand]').count()) === 1)
    check(`${name}: no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no count badge`, (await page.locator('.expanse-count').count()) === 0)
    const scaled = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].every((n) => parseFloat(n.style.getPropertyValue('--d')) > 0))
    check(`${name}: dots sized by the view (dot*k)`, scaled)

    const targets = ['.rings-wrap [data-expanse-drop]', '.rings-wrap .ring-more >> nth=0', '.rings-wrap .ring-more >> nth=1']
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
