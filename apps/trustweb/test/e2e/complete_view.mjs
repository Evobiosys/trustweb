// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 complete-view proof (headless): PORT=5480 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node complete_view.mjs. Synthetic records. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5480}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const DAY = 86_400_000
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const RINGS = ['closest', 'close', 'friend', 'acquaintance']
const mk = (i, o = {}) => ({ id: `p${i}`, name: `Person ${String(i).padStart(3, '0')}`, ring: RINGS[i % 4], lines: [], context: i % 3 ? '' : 'Met at the fair', metAt: Date.now() - (i + 1) * 5 * DAY, fields: {}, ...o })
const open = async (browser, opts, people) => {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
  return { ctx, page, errors }
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [name, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const people = Array.from({ length: 12 }, (_, i) => mk(i, i === 1 ? { cadenceDays: 7 } : i === 2 ? { cadenceDays: 365 } : {}))
    const { ctx, page, errors } = await open(browser, { viewport: vp }, people)
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(300); await page.locator('[data-view-drop] [data-view="complete"]').click(); await page.waitForTimeout(500)
    check(`${name}: eye > Table opens the table`, (await page.locator('[data-complete-view]').count()) === 1)
    check(`${name}: 12 rows`, (await page.locator('[data-cv-row]').count()) === 12)
    check(`${name}: default sort = last contact ascending (most drifted first)`, (await page.locator('[data-cv-row]').first().getAttribute('data-cv-row')) === 'p11')
    check(`${name}: header (table) ${name === '1280' ? 'visible' : 'hidden'} `, (await page.locator('.cv-head').isVisible()) === (name === '1280'))
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-table.png` })

    if (name === '1280') await page.locator('[data-cv-sort="name"]').click(); else await page.locator('[data-cv-sort-select]').selectOption('name')
    await page.waitForTimeout(200)
    check(`${name}: sort by name ascending`, (await page.locator('[data-cv-row]').first().getAttribute('data-cv-row')) === 'p0')
    if (name === '1280') { await page.locator('[data-cv-sort="name"]').click(); await page.waitForTimeout(200); check(`${name}: second click reverses`, (await page.locator('[data-cv-row]').first().getAttribute('data-cv-row')) === 'p11') }
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-sort.png` })

    // overdue chip: p1 (7 days, last contact 10 days ago) is overdue, p2 (365) is not
    await page.locator('[data-cv-overdue]').click(); await page.waitForTimeout(200)
    const od = await page.locator('[data-cv-row]').evaluateAll((rs) => rs.map((r) => r.dataset.cvRow))
    check(`${name}: Overdue chip keeps only p1 (${od})`, od.length === 1 && od[0] === 'p1')
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-overdue.png` })
    await page.locator('[data-cv-overdue]').click(); await page.waitForTimeout(200)

    // cadence inline edit
    await page.locator('[data-cv-cadence="p4"]').selectOption('30'); await page.waitForTimeout(300)
    check(`${name}: cadence saved on the person`, (await stored(page)).people.find((p) => p.id === 'p4').cadenceDays === 30)
    check(`${name}: next reminder shown`, (await page.locator('[data-cv-row="p4"] .cv-c-next').innerText()).length > 4)
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-cadence.png` })

    // tag inline
    await page.locator('[data-cv-tag-input="p5"]').fill('Choir'); await page.locator('[data-cv-tag-input="p5"]').press('Enter'); await page.waitForTimeout(300)
    check(`${name}: tag chip appears on the row`, (await page.locator('[data-cv-row="p5"] [data-cv-tag]').count()) === 1)
    check(`${name}: tag stored on the person`, Object.values((await stored(page)).people.find((p) => p.id === 'p5').fields).includes('true'))

    // select 2 + delete + Undo
    await page.locator('[data-cv-check="p6"]').check(); await page.locator('[data-cv-check="p7"]').check(); await page.waitForTimeout(200)
    check(`${name}: bulk bar says 2 selected`, (await page.locator('[data-select-count]').innerText()) === '2 selected')
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-two-selected.png` })
    await page.locator('[data-select-delete]').click(); await page.waitForTimeout(400)
    check(`${name}: both gone from the table`, (await page.locator('[data-cv-row]').count()) === 10)
    check(`${name}: both tombstoned in the record`, (await stored(page)).people.filter((p) => p.deleted_at).length === 2)
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-deleted-toast.png` })
    await page.locator('.toast').click(); await page.waitForTimeout(400)
    check(`${name}: Undo brings both back`, (await page.locator('[data-cv-row]').count()) === 12 && (await stored(page)).people.filter((p) => p.deleted_at).length === 0)

    // keyboard: ArrowDown, Space, Escape
    await page.locator('.cv-body').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); await page.waitForTimeout(200)
    check(`${name}: arrow + Space selects the focused row`, (await page.locator('[data-select-count]').innerText().catch(() => '')) === '1 selected')
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    check(`${name}: Escape clears the selection`, (await page.locator('[data-select-count]').count()) === 0)

    // pin as the default view of Web, then the Web tab opens it from a cold start
    await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
    await page.locator('[data-view-more="complete"]').click(); await page.waitForTimeout(200)
    await page.locator('[data-view-pin="complete"]').last().click(); await page.waitForTimeout(300)
    check(`${name}: pinned as default view of Web`, (await stored(page)).uiViews?.webDefault === 'complete')
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
    check(`${name}: Web tab opens the complete view`, (await page.locator('[data-complete-view]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/complete-view-${name}-pinned.png` })

    check(`${name}: no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no page errors (${errors.join(' | ')})`, errors.length === 0)
    await ctx.close()
  }

  // 600 people: the table draws a window, not 600 rows
  const many = Array.from({ length: 600 }, (_, i) => mk(i))
  const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 900 } }, many)
  await page.locator('.view-menu-btn').click(); await page.waitForTimeout(300); await page.locator('[data-view-drop] [data-view="complete"]').click(); await page.waitForTimeout(600)
  const n0 = await page.locator('[data-cv-row]').count()
  check(`600 people: ${n0} DOM rows (< 120)`, n0 > 0 && n0 < 120)
  await page.locator('.cv-body').evaluate((b) => { b.scrollTop = 10000 }); await page.waitForTimeout(400)
  const n1 = await page.locator('[data-cv-row]').count()
  const firstId = await page.locator('[data-cv-row]').first().getAttribute('data-cv-row')
  check(`600 people scrolled: ${n1} DOM rows, rows changed (${firstId})`, n1 < 120 && firstId !== 'p599')
  check('600 people: count line says 600', (await page.locator('[data-cv-count]').innerText()).includes('600'))
  await page.screenshot({ path: `${SHOTS}/complete-view-1280-600-rows.png` })
  check('600: no page errors', errors.length === 0)
  await ctx.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
