// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-circles-view (headless): eye > Other views > Circles; drag a person into / out of a circle (mouse, and a held touch on the phone). PORT=5307 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node circles_view.mjs. Stock dummy people only. */
const { chromium } = await import(process.env.PW ?? process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5307}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const NAMES = ['Ada', 'Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gia', 'Hugo']
const people = NAMES.map((n, i) => ({ id: `p${i}`, name: n, ring: ['closest', 'close', 'friend', 'acquaintance'][i % 4], lines: [], context: '', metAt: Date.now(), fields: i < 3 ? { choir: 'true' } : i === 3 ? { choir: 'true', climb: 'true' } : {} }))
const TAGS = [{ id: 'choir', colour: '#1565c0', label: 'Choir' }, { id: 'climb', colour: '#2e7d32', label: 'Climbing' }, { id: 'empty', colour: '#c2185b', label: 'Neighbours' }]
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const tagsOf = async (page, id) => Object.keys((await stored(page)).people.find((p) => p.id === id).fields ?? {}).sort()
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
async function mouseDrag(page, from, to) {
  const a = await centre(from); const b = await centre(to)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.waitForTimeout(150)
  return async () => { await page.mouse.up(); await page.waitForTimeout(400) }
}
try {
  for (const [name, vp, touch] of [['1280', { width: 1280, height: 900 }, false], ['360', { width: 360, height: 780 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', JSON.stringify(t)) }, [record, TAGS])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(300)
    await page.locator('[data-view-other]').click(); await page.waitForTimeout(200)
    await page.locator('[data-view-drop] [data-view="circles"]').click(); await page.waitForTimeout(500)
    check(`${name}: eye > Other views > Circles opens the view`, (await page.locator('[data-circles]').count()) === 1)
    check(`${name}: one circle per tag plus the empty "create" tile`, (await page.locator('.circle:not(.circle-new)').count()) === 3 && (await page.locator('.circle-new').count()) === 1)
    check(`${name}: the new tile says what to do`, (await page.locator('.circle-new').innerText()).includes('Drop here to create a new circle'))
    check(`${name}: Choir ring shows its 4 people, Climbing 1, Neighbours none`, (await page.locator('[data-circle="choir"] .circle-av').count()) === 4 && (await page.locator('[data-circle="climb"] .circle-av').count()) === 1 && (await page.locator('[data-circle="empty"] .circle-av').count()) === 0)
    check(`${name}: Dan sits in two circles`, (await page.locator('[data-drag-pid="p3"].circle-av').count()) === 2)
    const sz = async (id) => (await page.locator(`[data-circle="${id}"]`).boundingBox()).width
    check(`${name}: a circle with more people is bigger`, (await sz('choir')) > (await sz('climb')) && (await sz('climb')) > (await sz('empty')))
    const rowBox = await page.locator('[data-circles-row]').evaluate((r) => ({ sw: r.scrollWidth, cw: r.clientWidth, wrap: getComputedStyle(r).flexWrap, ox: getComputedStyle(r).overflowX }))
    if (name === '360') check(`360: the circle row scrolls sideways (${rowBox.sw} > ${rowBox.cw})`, rowBox.sw > rowBox.cw && rowBox.ox === 'auto')
    else check('1280: the circles wrap into a grid', rowBox.wrap === 'wrap')
    check(`${name}: no document scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${SHOTS}/steer-circles-view-${name}-view.png` })

    // drag Eva (p4, in no circle) from the pool into Climbing
    const eva = page.locator('[data-circles-pool] [data-drag-pid="p4"]')
    await eva.scrollIntoViewIfNeeded()
    const climb = page.locator('[data-circle="climb"]')
    await climb.scrollIntoViewIfNeeded()
    let release
    if (!touch) {
      release = await mouseDrag(page, eva, climb)
      check(`${name}: while held, the circle under the pointer is lit`, (await page.locator('[data-circle="climb"].drop').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/steer-circles-view-${name}-drag.png` })
      await release()
    } else await touchDrag(page, ctx, eva, climb)
    check(`${name}: dropped into Climbing: Eva got the climb tag`, (await tagsOf(page, 'p4')).includes('climb'))
    check(`${name}: the circle now rings Eva too (2 avatars)`, (await page.locator('[data-circle="climb"] .circle-av').count()) === 2)
    check(`${name}: a toast says so`, /Eva is now in Climbing/.test(await page.locator('.toast').innerText()))
    await page.screenshot({ path: `${SHOTS}/steer-circles-view-${name}-added.png` })

    // out of a circle: open Choir, drag Cleo (p2) from its list onto the pool heading
    await page.locator('[data-circle-open="choir"]').click({ force: true }); await page.waitForTimeout(300)
    check(`${name}: tap on a circle opens its people`, (await page.locator('[data-circle-panel="choir"] .circle-chip').count()) === 4)
    await page.screenshot({ path: `${SHOTS}/steer-circles-view-${name}-open.png` })
    const cleo = page.locator('[data-circle-panel="choir"] [data-drag-pid="p2"]')
    const poolHead = page.locator('[data-circles-pool] .eyebrow')
    if (!touch) { const r = await mouseDrag(page, cleo, poolHead); await r() } else await touchDrag(page, ctx, cleo, poolHead)
    check(`${name}: dragged out: Cleo lost the choir tag`, !(await tagsOf(page, 'p2')).includes('choir'))
    check(`${name}: Choir has 3 people left`, (await page.locator('[data-circle-panel="choir"] .circle-chip').count()) === 3)

    // a slip inside the open list keeps the person
    const ben = page.locator('[data-circle-panel="choir"] [data-drag-pid="p1"]')
    if (!touch) { const r = await mouseDrag(page, ben, page.locator('[data-circle-panel="choir"] .circle-panel-head')); await r() } else await touchDrag(page, ctx, ben, page.locator('[data-circle-panel="choir"] .circle-panel-head'))
    check(`${name}: letting go over the open list removes nobody`, (await tagsOf(page, 'p1')).includes('choir'))

    // new circle by dropping on the empty tile
    await page.locator('[data-circle-new-name]').fill('Hikers')
    const fin = page.locator('[data-circles-pool] [data-drag-pid="p5"]')
    const tile = page.locator('.circle-new')
    await tile.scrollIntoViewIfNeeded()
    if (!touch) { const r = await mouseDrag(page, fin, tile); await r() } else await touchDrag(page, ctx, fin, tile)
    check(`${name}: dropped on the empty tile: a circle "Hikers" exists with Finn in it`, (await tagsOf(page, 'p5')).includes('hikers') && (await page.locator('[data-circle="hikers"] .circle-name').innerText()) === 'Hikers')
    const defined = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.colourtags')).some((t) => t.id === 'hikers' && t.label === 'Hikers'))
    check(`${name}: the new tag is defined once`, defined)

    // undo from the toast
    await page.locator('.toast').click(); await page.waitForTimeout(400)
    check(`${name}: Undo takes the new circle back`, (await page.locator('[data-circle="hikers"]').count()) === 0 && !(await tagsOf(page, 'p5')).includes('hikers'))

    // tap a person = card
    await page.locator('[data-circles-pool] [data-drag-pid="p0"]').click(); await page.waitForTimeout(500)
    check(`${name}: tap on a person opens the card`, (await page.locator('.card-name, .card-view, [data-card]').count()) > 0 || (await page.locator('h1').allInnerTexts()).join().includes('Ada'))
    await page.screenshot({ path: `${SHOTS}/steer-circles-view-${name}-card.png` })
    check(`${name}: no page errors (${errors.join(' | ').slice(0, 120)})`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)

/** A touch drag on the phone: hold 400 ms (the lift), move in steps, release. Chrome DevTools protocol touch events. */
async function touchDrag(page, ctx, from, to) {
  const cdp = await ctx.newCDPSession(page)
  const a = await centre(from); const b = await centre(to)
  const at = (x, y) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(a.x, a.y) })
  await page.waitForTimeout(400)
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8) }); await page.waitForTimeout(30) }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(500)
}
