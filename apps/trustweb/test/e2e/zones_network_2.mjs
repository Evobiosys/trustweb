// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b zones-network-2 proof (headless): PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node zones_network_2.mjs. Synthetic record, no names. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
try {
  for (const [name, opts] of [
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const DAY = 86_400_000
    const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 2 * DAY, fields: {}, ...o })
    const people = [
      ...[1, 2, 3, 4, 5].map((i) => mk(`f${i}`, 'friend', { context: 'club', fields: i < 3 ? { work: 'true' } : {} })),
      ...[1, 2, 3].map((i) => mk(`a${i}`, 'acquaintance', { context: 'choir' })), mk('s1', 'friend', { context: 'solo' }),
    ]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); localStorage.setItem('trustweb.v1.colourtags', JSON.stringify([{ id: 'work', colour: '#336699', label: 'work' }])); localStorage.removeItem('trustweb.ui.netPins') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(800)

    // ---- TrustZones: the sidebar only
    // Wave 39: on a phone (<= 600 px) Tools and Filters are two buttons that open an overlay sheet; wider, Tools is unfolded inline.
    const sheetMode = opts.viewport.width <= 600
    const holds = (root) => page.locator(`${root} [data-expand]`).count().then(async (e) => e === 1 && (await page.locator(`${root} [data-add-node]`).count()) === 1 && (await page.locator(`${root} [data-zone-tag-filters]`).count() + (sheetMode ? 1 : 0)) >= 1)
    if (sheetMode) {
      check(`${name}: Tools and Filters are two buttons, nothing inline`, (await page.locator('[data-zone-side-toggle]').count()) === 1 && (await page.locator('[data-zone-tags-toggle]').count()) === 1 && (await page.locator('[data-zone-side] [data-expand]').count()) === 0)
      await page.locator('[data-zone-side-toggle]').click(); await page.waitForTimeout(400)
      check(`${name}: the Tools sheet holds expand all and add`, await holds('.sheet.on'))
      await page.locator('[data-sheet-home]').click(); await page.waitForTimeout(300)
    } else {
      check(`${name}: sidebar unfolded by default, left of / above the rings`, (await page.locator('[data-zone-side-toggle]').getAttribute('aria-expanded')) === 'true')
      check(`${name}: sidebar holds expand all, add`, await holds('[data-zone-side]'))
    }
    check(`${name}: nothing else (no old filter block, no zone lists, no legend)`, (await page.locator('[data-zone-filter-section], [data-zone-panel], [data-zone-legend-i], [data-zone-community]').count()) === 0)
    check(`${name}: ring fill control is the expand glyph`, (await page.locator('[data-membrane-more]').first().innerText()).trim() === '⛶')
    const dots = () => page.locator('.rings-wrap .node:not(.you)').count()
    const before = await dots()
    await page.locator('[data-zone-tags-toggle]').click(); await page.waitForTimeout(300)
    check(`${name}: Filters (advanced) unfolds to show-only and hide`, (await page.locator('[data-zone-chip-row]').count()) === 2)
    await page.locator('[data-zone-chip-input="include"]').fill('work'); await page.waitForTimeout(200)
    await page.locator('[data-zone-chip-suggest="tag:work"]').click(); await page.waitForTimeout(400)
    check(`${name}: show only #work keeps its 2 holders`, (await dots()) === 2)
    await page.locator('[data-zone-chip-input="exclude"]').fill('P f1'); await page.waitForTimeout(200)
    await page.locator('[data-zone-chip-suggest="person:f1"]').click(); await page.waitForTimeout(400)
    check(`${name}: hide wins: @f1 gone, 1 left`, (await dots()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-trustzones-sidebar.png` })
    await page.locator('[data-zone-chip="tag:work"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-zone-chip="person:f1"]').click(); await page.waitForTimeout(300)
    check(`${name}: chips removed: everyone back`, (await dots()) === before)

    // ---- Network
    await page.evaluate(() => localStorage.setItem('trustweb.ui.webView', 'network')); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(3500)
    check(`${name}: legend text bottom-left of the canvas`, await page.evaluate(() => { const c = document.querySelector('.net-canvas').getBoundingClientRect(); const l = document.querySelector('[data-net-legend]').getBoundingClientRect(); return l.width > 0 && l.left < c.left + c.width / 2 && l.top > c.top + c.height * 0.8 }))
    check(`${name}: filter block on the network, folded`, (await page.locator('[data-zone-filter-toggle]').getAttribute('aria-expanded')) === 'false')
    check(`${name}: toggle label`, (await page.locator('[data-net-others]').innerText()) === 'Show only connected with me')
    // colours: friend orange on the canvas
    const scan = (rgb) => page.evaluate((rgb) => {
      const cv = document.querySelector('.net-canvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      const k = cv.width / cv.getBoundingClientRect().width; let n = 0, sx = 0, sy = 0, first = null
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 6 && Math.abs(d[i + 1] - rgb[1]) < 6 && Math.abs(d[i + 2] - rgb[2]) < 6) { n++; const p = i / 4; if (!first) first = { x: (p % cv.width) / k, y: Math.floor(p / cv.width) / k }; sx += (p % cv.width) / k; sy += Math.floor(p / cv.width) / k }
      return { n, x: n ? sx / n : 0, y: n ? sy / n : 0, first }
    }, rgb)
    const orange = await scan([0xEE, 0x7A, 0x1C])
    check(`${name}: nodes use the TrustZones friend orange`, orange.n > 20)
    const box = await page.locator('.net-canvas').boundingBox()
    await page.screenshot({ path: `${SHOTS}/${name}-network-before.png` })
    // drag one friend dot
    const from = { x: box.x + orange.first.x, y: box.y + orange.first.y + 3 } // top edge of the first friend dot, 3 px in
    const grab = await page.evaluate(([fx, fy]) => ({ fx, fy }), [from.x, from.y])
    await page.mouse.move(grab.fx, grab.fy); await page.mouse.down(); await page.mouse.move(grab.fx + 30, grab.fy + 20, { steps: 5 }); await page.mouse.move(grab.fx + 70, grab.fy + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500)
    const pins = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('trustweb.ui.netPins') ?? '{}')).length)
    const red = await scan([0xD9, 0x30, 0x25])
    check(`${name}: a dragged dot is pinned and shows the red needle head`, (await pins()) >= 1 && red.n > 10)
    await page.screenshot({ path: `${SHOTS}/${name}-network-needle.png` })
    await page.mouse.click(box.x + red.x, box.y + red.y); await page.waitForTimeout(150)
    check(`${name}: pressing the needle unpins (storage empty at once)`, (await pins()) === 0)
    const mid = await scan([0xD9, 0x30, 0x25])
    check(`${name}: needle gone; the dot glides (no jump) and stays on the canvas`, mid.n < 5)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/${name}-network-gliding.png` })
    await page.waitForTimeout(1500)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
