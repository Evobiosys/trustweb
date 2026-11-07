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
    let expanse = []
    let people = [...Array.from({ length: 9 }, (_, i) => mk(`f${i}`, 'friend')), ...Array.from({ length: 8 }, (_, i) => mk(`a${i}`, 'acquaintance'))]
    const load = async (uiRings) => {
      const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people, ...(expanse.length ? { expanse } : {}), ...(uiRings ? { uiRings } : {}) })
      await page.goto(URL); await page.waitForTimeout(1500)
      await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    }
    await load()
    check(`${name}: no expand buttons by default`, (await page.locator('.rings-wrap .ring-more').count()) === 0 && (await page.locator('.rings-wrap .ring-toggle').count()) >= 2)
    const onRing = await page.evaluate(() => {
      const w = document.querySelector('.rings-wrap').getBoundingClientRect(), z = 352 / w.width
      return [...document.querySelectorAll('.rings-wrap .ring-toggle')].map((d) => {
        const c = document.querySelector(`.rings-wrap svg circle[data-ring="${d.dataset.hideRing}"]`).getBoundingClientRect(), r = d.getBoundingClientRect()
        return { dy: ((r.y + r.height / 2) - c.bottom) * z, dx: ((r.x + r.width / 2) - (c.x + c.width / 2)) * z, top: r.y }
      })
    })
    check(`${name}: each diamond sits on its ring at 6 o'clock (within 1 px, ${onRing.map((o) => o.dy.toFixed(1))})`, onRing.every((o) => Math.abs(o.dy) <= 1 && Math.abs(o.dx) <= 1))
    check(`${name}: innermost ring = topmost diamond`, onRing.every((o, i) => i === 0 || onRing[i - 1].top < o.top))
    await load({ expandButtons: true })

    const geo = await page.evaluate(() => {
      const w = document.querySelector('.rings-wrap').getBoundingClientRect(), z = 352 / w.width // the view may be zoomed: measure in the wrap's own px
      const box = (e) => { const r = e.getBoundingClientRect(); return { x: (r.x + r.width / 2 - w.x) * z, y: (r.y + r.height / 2 - w.y) * z, w: Math.round(r.width * z), r: (r.width * z) / 2 } }
      return {
        diamonds: [...document.querySelectorAll('.rings-wrap .ring-toggle')].map(box),
        more: [...document.querySelectorAll('.rings-wrap .ring-more')].map(box),
        dots: [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map(box),
        stray: [...document.querySelectorAll('.rings-wrap > *')].filter((e) => !e.matches('svg, .node, .zzz, .ring-toggle, .ring-more, .rings-hint, .ring-card')).map((e) => e.className),
        expanseDrop: document.querySelectorAll('.rings-wrap [data-expanse-drop]').length,
      }
    })
    const { diamonds, more, dots } = geo
    check(`${name}: 3 diamonds (friend, acquaintance, close ring) , 2 expand buttons`, diamonds.length >= 2 && more.length === 2)
    check(`${name}: diamonds in ONE column at the centre x`, diamonds.every((c) => Math.abs(c.x - 176) < 1))
    const ys = diamonds.map((c) => c.y).sort((p, q) => q - p)
    check(`${name}: diamonds at least 20 px apart`, ys.slice(1).every((y, i) => ys[i] - y >= 19))
    check(`${name}: each expand button sits on its diamond's row, 20 px to the right, 16 px`, more.every((m) => diamonds.some((d) => Math.abs(d.y - m.y) < 1 && Math.abs(m.x - d.x - 20) < 1)) && more.every((m) => m.w === 16))
    check(`${name}: diamonds are 16 px`, diamonds.every((c) => c.w === 16))
    check(`${name}: nothing outside the column except dots (no corner diamonds, no orange expand ring)`, geo.stray.length === 0 && geo.expanseDrop === 0 && [...diamonds, ...more].every((c) => c.x >= 176 - 1 && c.x <= 176 + 21))
    const ctl = [...diamonds, ...more]
    const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r
    let dd = Infinity, dc = Infinity
    dots.forEach((a, i) => { dots.slice(i + 1).forEach((b) => { dd = Math.min(dd, gap(a, b)) }); ctl.forEach((c) => { dc = Math.min(dc, gap(a, c)) }) })
    check(`${name}: no dot overlaps another (min gap ${dd.toFixed(1)})`, dd >= -1)
    check(`${name}: no dot overlaps a control (min gap ${dc.toFixed(1)})`, dc >= -1)
    check(`${name}: no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    const scaled = await page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].every((n) => parseFloat(n.style.getPropertyValue('--d')) > 0))
    check(`${name}: dots sized by the view (dot*k)`, scaled)

    const targets = ['.rings-wrap .ring-toggle >> nth=0', '.rings-wrap .ring-more >> nth=0', '.rings-wrap .ring-toggle >> nth=1']
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
    // Wave 34: two bins while a dot is held.
    check(`${name}: no bins while nothing is held`, (await page.locator('[data-bin]').count()) === 0)
    const grab = async () => {
      const node = page.locator('.rings-wrap .node:not(.you)').first()
      const nb = await node.boundingBox()
      const pid = await node.getAttribute('data-pid')
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
      await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
      return pid
    }
    const toBin = async (kind) => { const b = await page.locator(`[data-bin=${kind}]`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }) }
    let pid = await grab()
    check(`${name}: both bins show while holding, inside the viewport`, (await page.locator('[data-bin]').count()) === 2 && await page.evaluate(() => [...document.querySelectorAll('[data-bin]')].every((b) => b.getBoundingClientRect().bottom <= innerHeight)))
    await page.screenshot({ path: `/tmp/drag_bins_${name}_held.png` })
    await toBin('archive')
    check(`${name}: archive bin shows .drop`, await page.locator('[data-bin=archive]').evaluate((e) => e.classList.contains('drop')))
    await page.mouse.up(); await page.waitForTimeout(400)
    check(`${name}: bins vanish on release`, (await page.locator('[data-bin]').count()) === 0)
    check(`${name}: drop on archive removes the dot and offers Undo`, (await page.locator(`.rings-wrap [data-pid="${pid}"]`).count()) === 0 && (await page.locator('[data-undo-archive]').count()) === 1)
    await page.locator('[data-undo-archive]').click(); await page.waitForTimeout(400)
    check(`${name}: Undo brings the dot back`, (await page.locator(`.rings-wrap [data-pid="${pid}"]`).count()) === 1)
    pid = await grab()
    await toBin('remove')
    await page.mouse.up(); await page.waitForTimeout(400)
    check(`${name}: drop on remove deletes at once, no question, Undo offered`, (await page.locator('[data-delete-yes]').count()) === 0 && (await page.locator(`.rings-wrap [data-pid="${pid}"]`).count()) === 0 && (await page.locator('[data-undo-delete]').count()) === 1)
    await page.locator('[data-undo-delete]').click(); await page.waitForTimeout(400)
    check(`${name}: Undo keeps the dot`, (await page.locator(`.rings-wrap [data-pid="${pid}"]`).count()) === 1)
    await page.locator('.rings-wrap .node.you').dispatchEvent('contextmenu'); await page.waitForTimeout(300)
    check(`${name}: sheet (context press on you) lists 3 hidden`, (await page.locator('[data-expanse-restore-one]').count()) === 3 && (await page.locator('[data-expanse-count="3"]').count()) === 1)
    // Wave 35 rings-filters-2: 300 acquaintances -> 5 dots; toggle; hidden row.
    people = [...Array.from({ length: 3 }, (_, i) => mk(`c${i}`, 'close')), ...Array.from({ length: 12 }, (_, i) => mk(`f${i}`, 'friend')), ...Array.from({ length: 300 }, (_, i) => mk(`a${i}`, 'acquaintance'))]
    expanse = ['f0']
    await load({ expandButtons: true })
    const dotsOf = (r) => page.locator(`.rings-wrap .node:not(.you)[data-pid^="${r[0]}"]`).count()
    check(`${name}: 300 acquaintances -> 5 dots on that ring`, (await dotsOf('acquaintance')) === 5)
    check(`${name}: the row's text button reads "most recent"`, (await page.locator('[data-recent-mode]').innerText()) === 'most recent')
    await page.locator('[data-recent-mode]').click(); await page.waitForTimeout(400)
    check(`${name}: tap switches to "most frequently connected"`, (await page.locator('[data-recent-mode]').innerText()) === 'most frequently connected')
    check(`${name}: still 5 acquaintance dots`, (await dotsOf('acquaintance')) === 5)
    check(`${name}: Hidden people row present`, (await page.locator('[data-hidden-people]').count()) === 1)
    await page.screenshot({ path: `/tmp/rings_filters_2_${name}.png` })
    await page.locator('[data-hidden-people]').click(); await page.waitForTimeout(300)
    check(`${name}: Hidden people opens the same sheet`, (await page.locator('[data-expanse-count]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    await page.screenshot({ path: `/tmp/rings_controls_${name}.png` })
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
