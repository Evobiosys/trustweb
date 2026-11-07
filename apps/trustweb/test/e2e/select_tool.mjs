// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b select-tool proof (headless): PORT=5480 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node select_tool.mjs. Synthetic record. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5480}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
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
    const people = [...Array.from({ length: 5 }, (_, i) => mk(`f${i}`, 'friend', { angle: 20 + i * 40 })), ...Array.from({ length: 4 }, (_, i) => mk(`a${i}`, 'acquaintance', { angle: 215 + i * 30 }))]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Maximilian Musterfrau' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const spots = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => [n.dataset.pid, [n.style.left, n.style.top]])))
    const before = await spots()
    const grab = async (pid) => {
      const nb = await page.locator(`.rings-wrap [data-pid="${pid}"]`).boundingBox()
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
      await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
    }
    const toBin = async (kind) => { const b = await page.locator(`[data-bin=${kind}]`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }) }
    const eye = async (view) => { await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200); await page.locator(`[data-view-drop] [data-view="${view}"]`).click(); await page.waitForTimeout(500) }

    // 1: three tool buttons in one row, same size.
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.zone-tools > button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top + r.height / 2)] }))
    check(`${name}: tool row has 3 buttons: expand, +, select (${JSON.stringify(sizes)})`, sizes.length === 3 && (await page.locator('.zone-tools > [data-tool="select"]').count()) === 1)
    check(`${name}: the three sit on one row, same size`, new Set(sizes.map((s) => s[2])).size === 1 && new Set(sizes.map((s) => s[0] + 'x' + s[1])).size === 1)
    check(`${name}: Space out is not in the tool row`, (await page.locator('.zone-tools [data-space-out-tools]').count()) === 0 && (await page.locator('[data-space-out-tools]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-toolrow.png` })

    // 2: select mode, tick three.
    await page.locator('[data-tool="select"]').click(); await page.waitForTimeout(300)
    check(`${name}: select tool pressed`, (await page.locator('.zone-tools [data-tool="select"]').getAttribute('aria-pressed')) === 'true')
    for (const id of ['f0', 'f1', 'f2']) await page.locator(`.rings-wrap [data-pid="${id}"]`).click()
    await page.waitForTimeout(200)
    check(`${name}: 3 dots ticked, chip "3 selected", no card opened`, (await page.locator('.rings-wrap .node.multi-sel').count()) === 3 && (await page.locator('[data-select-count]').innerText()) === '3 selected' && (await page.locator('[data-ring-card]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-three-selected.png` })

    // 3: drag one ticked dot to the dustbin: all three go; Undo (10 s) brings them back at their places.
    await grab('f1'); await toBin('remove'); await page.mouse.up(); await page.waitForTimeout(500)
    const gone = await spots()
    check(`${name}: all 3 gone, 6 dots left`, Object.keys(gone).length === 6 && !('f0' in gone) && !('f1' in gone) && !('f2' in gone))
    check(`${name}: toast carries data-undo-multi`, (await page.locator('[data-undo-multi]').count()) === 1)
    await page.waitForTimeout(6000)
    check(`${name}: still shown after 6 s (window is 10 s)`, await page.locator('[data-undo-multi]').isVisible())
    await page.locator('[data-undo-multi]').click(); await page.waitForTimeout(500)
    const back = await spots()
    check(`${name}: Undo: 3 back at their places`, ['f0', 'f1', 'f2'].every((k) => back[k]?.[0] === before[k][0] && back[k]?.[1] === before[k][1]))

    // 4: the multi toast leaves after 10 s.
    for (const id of ['a0', 'a1']) await page.locator(`.rings-wrap [data-pid="${id}"]`).click()
    await grab('a0'); await toBin('archive'); await page.mouse.up(); await page.waitForTimeout(500)
    check(`${name}: archive of 2 shows data-undo-multi`, (await page.locator('[data-undo-multi]').count()) === 1)
    await page.waitForTimeout(10_300)
    check(`${name}: the multi toast is gone after 10 s`, !(await page.locator('[data-undo-multi]').isVisible()))

    // 5: leaving select mode (second press) clears the selection; Esc and empty-space tap leave too.
    await page.locator(`.rings-wrap [data-pid="f3"]`).click()
    await page.locator('[data-tool="select"]').click(); await page.waitForTimeout(300)
    check(`${name}: second press leaves the mode and clears the ticks`, (await page.locator('.node.multi-sel').count()) === 0 && (await page.locator('[data-tool="select"]').getAttribute('aria-pressed')) === 'false')
    await page.locator('[data-tool="select"]').click(); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    check(`${name}: Esc leaves the mode`, (await page.locator('[data-tool="select"]').getAttribute('aria-pressed')) === 'false')

    // 6: a single action undoes for 5 s.
    await grab('f4'); await toBin('remove'); await page.mouse.up(); await page.waitForTimeout(2500)
    check(`${name}: single delete: Undo still shown at 2.5 s, no data-undo-multi`, (await page.locator('[data-undo-delete]').isVisible()) && (await page.locator('[data-undo-multi]').count()) === 0)
    await page.waitForTimeout(3500)
    check(`${name}: single delete: Undo gone after 5 s`, !(await page.locator('[data-undo-delete]').isVisible()))

    // 7: centre dot without name; tap opens the own profile page.
    check(`${name}: centre dot shows no name text`, ((await page.locator('.node.you').innerText()).trim().length <= 2) && !(await page.locator('.node.you').innerText()).includes('Maximilian'))
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-centre.png` })
    await page.locator('.node.you').click(); await page.waitForTimeout(500)
    check(`${name}: own profile page opens`, (await page.locator('[data-own-profile]').count()) === 1)
    check(`${name}: five trust-zone sections`, (await page.locator('[data-own-zone]').count()) === 5)
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-own-profile.png` })
    await page.goBack(); await page.waitForTimeout(500)

    // 8: ring filter: hidden on Web and People, collapsed on Network, there on Map only when a map page exists.
    check(`${name}: Web: no ring filter`, (await page.locator('[data-filter-group="trustzones"]').count()) === 0)
    await eye('network')
    check(`${name}: Network: ring filter present and collapsed`, (await page.locator('[data-filter-group="trustzones"]').count()) === 1 && (await page.locator('[data-filter-group="trustzones"]').getAttribute('open')) === null)
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-network-filter.png` })
    await eye('people')
    check(`${name}: People: top strip with the select tool, no ring filter, no bottom Select row`, (await page.locator('[data-top-tools] [data-tool="select"]').count()) === 1 && (await page.locator('[data-filter-group="trustzones"]').count()) === 0 && (await page.locator('[data-select-start]').count()) === 0)
    await page.locator('[data-top-tools] [data-tool="select"]').click(); await page.waitForTimeout(300)
    check(`${name}: People: the tool turns the checkboxes on (bar shows count)`, (await page.locator('[data-select-count]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-people.png` })
    await page.goBack(); await page.waitForTimeout(500)

    // 9: eye menu ⋮ has no underline.
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(300)
    const deco = await page.locator('[data-view-more]').first().evaluate((b) => getComputedStyle(b).textDecorationLine)
    check(`${name}: eye menu ⋮ not underlined (${deco})`, deco === 'none')
    await page.screenshot({ path: `${SHOTS}/select-tool-${name}-eye-menu.png` })

    check(`${name}: no page errors (${errors.join(' | ').slice(0, 120)})`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
