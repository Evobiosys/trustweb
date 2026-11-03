// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 trustzones-view proof (headless, dev server with the personal record): PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node trustzones_view.mjs. Counts and facts only, no names. */
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
    const tap = (sel) => (opts.hasTouch ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    const DAY = 86_400_000
    const mk = (id, ring, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - 2 * DAY, ...o })
    const people = [
      mk('c1', 'closest'), mk('k1', 'close', { peerId: 'pe1', metAt: Date.now() - 60 * DAY, pinned: true, pinnedAt: 5 }), mk('k2', 'close', { peerId: 'pe2', metAt: Date.now() - 60 * DAY }),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk(`f${i}`, 'friend')),
      ...[1, 2, 3].map((i) => mk(`a${i}`, 'acquaintance')), mk('i1', 'intending'), mk('u1', 'unsorted'), mk('x1', 'none', { name: 'Archived Person' }),
    ]
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], engagementSince: Date.now() - 90 * DAY, people })
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(800)
    check(`${name}: heading is TrustZones`, (await page.locator('h1,h2').filter({ hasText: 'TrustZones' }).count()) > 0)
    check(`${name}: Filter (advanced) folded by default`, (await page.locator('[data-zone-filter-toggle]').getAttribute('aria-expanded')) === 'false' && (await page.locator('[data-zone-filter]').count()) === 0)
    check(`${name}: not yet sorted is off (no grey dot), archived never shown`, (await page.locator('[data-pid="u1"]').count()) === 0 && (await page.locator('[data-pid="x1"], [data-zone-row="x1"]').count()) === 0)
    check(`${name}: pinned dot has the light red border class, pinned listed on top outside the sections`, (await page.locator('.node.pinned[data-pid="k1"]').count()) === 1 && (await page.locator('[data-zone-pinned] [data-zone-row="k1"].pinned').count()) === 1)
    check(`${name}: closest few unfolded by default, the others folded`, (await page.locator('[data-zone-toggle="closest"]').getAttribute('aria-expanded')) === 'true' && (await page.locator('[data-zone-toggle="friend"]').getAttribute('aria-expanded')) === 'false')
    // zzz: the quiet close people carry a marker; nothing moved
    check(`${name}: zzz marker on the quiet close people, nobody moved`, (await page.locator('[data-zzz]').count()) === 2 && (await page.locator('[data-zone-toggle="close"]').count()) === 1)
    // fill triangle
    const tri = page.locator('[data-membrane-more="friend"]')
    check(`${name}: hover title says "tap to add"`, (await tri.getAttribute('title')) === 'tap to add a friend or community member')
    check(`${name}: friends ring shows the closest five, triangle folded, no list button`, (await page.locator('.rings-wrap .node[data-tone="2"]').count()) === 5 && (await tri.getAttribute('aria-expanded')) === 'false' && (await page.locator('[data-membrane-list="friend"]').count()) === 0)
    await tap('[data-membrane-more="friend"]'); await page.waitForTimeout(300)
    check(`${name}: first press fills all 8, no page, triangle in place, list button appears`, (await page.locator('.rings-wrap .node[data-tone="2"]').count()) === 8 && (await page.locator('[data-membrane-more="friend"]').getAttribute('aria-expanded')) === 'true' && (await page.locator('[data-membrane-list="friend"]').count()) === 1 && (await page.locator('[data-membrane-rest]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/${name}-filled.png` })
    await page.reload(); await page.waitForTimeout(800)
    check(`${name}: reload keeps the fill`, (await page.locator('[data-membrane-list="friend"]').count()) === 1)
    await tap('[data-membrane-list="friend"]'); await page.waitForTimeout(300)
    check(`${name}: the list button opens the list page with Back`, (await page.locator('[data-membrane-rest]').count()) === 1)
    await page.goBack(); await page.waitForTimeout(300)
    await tap('[data-membrane-more="friend"]'); await page.waitForTimeout(300)
    check(`${name}: second press folds back to five`, (await page.locator('.rings-wrap .node[data-tone="2"]').count()) === 5)
    // filter section
    await tap('[data-zone-filter-toggle]'); await page.waitForTimeout(300)
    check(`${name}: filter unfolds: one checkbox per ring, all on`, (await page.locator('[data-zone-filter]').count()) === 6 && (await page.locator('[data-zone-filter]:checked').count()) === 6)
    await page.locator('[data-zone-filter="unsorted"]').uncheck(); await page.waitForTimeout(300); await page.locator('[data-zone-filter="unsorted"]').check(); await page.waitForTimeout(300)
    check(`${name}: not yet sorted on shows the grey dot, six tone steps`, (await page.locator('[data-pid="u1"]').count()) === 1 && (await page.evaluate(() => new Set([...document.querySelectorAll('.rings-wrap .node[data-tone]')].map((n) => n.dataset.tone)).size)) === 6)
    await page.screenshot({ path: `${SHOTS}/${name}-six-tones.png` })
    await page.reload(); await page.waitForTimeout(800)
    check(`${name}: reload keeps the filter state`, (await page.locator('[data-zone-filter="unsorted"]').isChecked()) && (await page.locator('[data-pid="u1"]').count()) === 1)
    await page.locator('[data-zone-filter="unsorted"]').uncheck(); await page.waitForTimeout(300)
    // rename in the list
    await tap('[data-zone-toggle="friend"]'); await page.waitForTimeout(200)
    await page.locator('[data-zone-name-edit="f1"]').click()
    await page.locator('.zone-row .tap-edit-input').fill('Renamed Friend'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    check(`${name}: a name edits in the list`, (await page.locator('[data-zone-row="f1"]').innerText()).includes('Renamed Friend'))
    // zzz: one tap accepts one, the strip accepts the rest of the kind
    await page.screenshot({ path: `${SHOTS}/${name}-zzz.png` })
    await tap('[data-zzz="k2"]'); await page.waitForTimeout(400)
    check(`${name}: zzz tap moves that one person to friends, the other stays`, (await page.locator('[data-zzz]').count()) === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people.filter((p) => p.ring === 'friend' && p.id === 'k2').length)) === 1)
    await tap('[data-zzz-all="close>friend"]'); await page.waitForTimeout(400)
    check(`${name}: accept all of the kind moves the rest, markers gone`, (await page.locator('[data-zzz]').count()) === 0)
    // legend under (i)
    check(`${name}: legend hidden until (i)`, await page.locator('[data-zone-legend]').isHidden())
    await tap('[data-zone-legend-i]'); await page.waitForTimeout(200)
    check(`${name}: legend text`, (await page.locator('[data-zone-legend]').innerText()) === 'solid = both know each other, dashed = one-way')
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
