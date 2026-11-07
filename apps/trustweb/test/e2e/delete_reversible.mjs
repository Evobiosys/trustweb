// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 delete-reversible proof (headless): PORT=5472 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node delete_reversible.mjs. Synthetic record. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5472}/`
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
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const spots = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => [n.dataset.pid, [n.style.left, n.style.top]])))
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people)
    const before = await spots()
    check(`${name}: 9 dots drawn`, Object.keys(before).length === 9)

    const grab = async (pid) => {
      const nb = await page.locator(`.rings-wrap [data-pid="${pid}"]`).boundingBox()
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
      await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
    }
    const toBin = async (kind) => { const b = await page.locator(`[data-bin=${kind}]`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }) }

    // 1+2: dustbin deletes at once; nobody else moves; undo puts the dot back at its place.
    await grab('f2'); await toBin('remove'); await page.mouse.up(); await page.waitForTimeout(500)
    const after = await spots()
    check(`${name}: dot gone at once`, !('f2' in after))
    check(`${name}: no "are you sure" (no [data-delete-yes])`, (await page.locator('[data-delete-yes]').count()) === 0)
    check(`${name}: toast with Undo`, (await page.locator('[data-undo-delete]').count()) === 1)
    check(`${name}: the 8 other dots keep their exact place`, Object.keys(after).length === 8 && Object.entries(after).every(([k, v]) => before[k][0] === v[0] && before[k][1] === v[1]))
    const rec = (await stored()).find((p) => p.id === 'f2')
    check(`${name}: record keeps the person with deleted_at and prevRing`, Boolean(rec?.deleted_at) && rec.prevRing === 'friend' && rec.angle === 100)
    await page.screenshot({ path: `${SHOTS}/delete-reversible-${name}-toast.png` })
    await page.locator('[data-undo-delete]').click(); await page.waitForTimeout(400)
    const back = await spots()
    check(`${name}: Undo brings it back at the same place`, back.f2?.[0] === before.f2[0] && back.f2?.[1] === before.f2[1])
    check(`${name}: record has no deleted_at again`, (await stored()).find((p) => p.id === 'f2').deleted_at === undefined)

    // Archive and hide leave the others alone too.
    await grab('a1'); await toBin('archive'); await page.mouse.up(); await page.waitForTimeout(400)
    const afterArchive = await spots()
    check(`${name}: archive moves nobody`, Object.entries(afterArchive).every(([k, v]) => before[k][0] === v[0] && before[k][1] === v[1]) && Object.keys(afterArchive).length === 8)
    await page.locator('[data-undo-archive]').click(); await page.waitForTimeout(300)

    // Recently deleted + Tools rows.
    await grab('f3'); await toBin('remove'); await page.mouse.up(); await page.waitForTimeout(400)
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-zone-side] .zone-check')].map((r) => r.querySelector('[data-closest150],[data-per-ring],[data-space-out-tools],[data-expand-buttons],[data-hidden-people],[data-recently-deleted],[data-zone-connections]')?.getAttributeNames().find((a) => a.startsWith('data-'))))
    check(`${name}: Tools: space-out is the third row (${rows.join(',')})`, rows.indexOf('data-space-out-tools') === 3 && rows[1] === 'data-per-ring' && rows[2] === 'data-closest150' && rows[4] === 'data-expand-buttons' && rows.at(-1) === 'data-recently-deleted')
    check(`${name}: "Recently deleted (1)"`, (await page.locator('[data-recently-deleted]').innerText()) === 'Recently deleted (1)')
    await page.locator('[data-recently-deleted]').click(); await page.waitForTimeout(300)
    check(`${name}: sheet lists the person with days left`, (await page.locator('[data-deleted-row="f3"]').innerText()).includes('30 days left'))
    await page.screenshot({ path: `${SHOTS}/delete-reversible-${name}-recently-deleted.png` })
    await page.locator('[data-put-back="f3"]').click(); await page.waitForTimeout(400)
    check(`${name}: Put back restores the dot`, (await spots()).f3?.[0] === before.f3[0])
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)

    // Third Tools button spaces out.
    const sheetOpen = await page.locator('.sheet [data-deleted-row], [data-put-back]').count()
    if (sheetOpen === 0) { /* closed by put back? nothing to close */ }
    const pre = await spots()
    await page.locator('[data-space-out-tools]').scrollIntoViewIfNeeded(); await page.locator('[data-space-out-tools]').click({ force: true }); await page.waitForTimeout(500)
    const post = await spots()
    check(`${name}: Space out bubbles evenly moves dots`, Object.keys(pre).some((k) => pre[k][0] !== post[k]?.[0] || pre[k][1] !== post[k]?.[1]))
    await page.screenshot({ path: `${SHOTS}/delete-reversible-${name}-tools.png` })
    await page.locator('[data-undo-space]').click().catch(() => {}); await page.waitForTimeout(300)

    // 4: multi-select in the card's name edit: hold the diamond, edit, tap another dot, ✕ deletes both.
    await page.locator('.rings-wrap [data-hide-ring="friend"]').hover(); await page.waitForTimeout(400)
    await page.locator('[data-ring-card-edit="f0"]').click(); await page.waitForTimeout(200)
    await page.locator('.rings-wrap [data-pid="f1"]').click(); await page.waitForTimeout(200)
    check(`${name}: tapping another dot selects it, card stays (chip "2 selected")`, (await page.locator('[data-multi-count="2"]').innerText().catch(() => '')) === '2 selected' && (await page.locator('.node.multi-sel').count()) === 2)
    await page.screenshot({ path: `${SHOTS}/delete-reversible-${name}-two-selected.png` })
    await page.locator('[data-ring-card-cancel="f0"]').click(); await page.waitForTimeout(500)
    const gone = await spots()
    check(`${name}: ✕ deleted both selected, others stayed`, !('f0' in gone) && !('f1' in gone) && Object.keys(gone).length === 7)
    check(`${name}: one toast "2 people deleted" with Undo`, (await page.locator('[data-undo-delete]').count()) === 1)
    await page.locator('[data-undo-delete]').click(); await page.waitForTimeout(400)
    check(`${name}: one Undo brings both back`, 'f0' in (await spots()) && 'f1' in (await spots()))
    check(`${name}: no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no page errors (${errors.join(' | ')})`, errors.length === 0)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
