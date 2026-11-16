// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views proof (headless, stock dev server): PORT=5445 SHOTS=<dir> PW=<playwright-core index.mjs> EXE=<chromium headless shell> node resource_views.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5445}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const it = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1, ...over })
const record = JSON.stringify({ v: 1, bwMode: true, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], events: [],
  people: [{ id: 'p1', name: 'Ada Lovelace', ring: 1, lines: [], context: '', metAt: 1 }, { id: 'p2', name: 'Ben Huber', ring: 1, lines: [], context: '', metAt: 1 }],
  inventory: [
    it('i1', 'Cosmos, recommended by Ada Lovelace', { kind: 'book' }),
    it('i2', 'Dune', { kind: 'book', sharedBy: 'p1', communityId: 'c1' }),
    it('i3', 'Hidden talk', { kind: 'recording', protected: true, link: 'https://example.org/a' }),
    it('i4', 'Second secret', { kind: 'reference', protected: true, link: 'https://example.org/b' }),
    it('i5', 'Plain note'),
  ] })
const boxes = (page, a, b) => page.evaluate(([x, y]) => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const p = r(x), q = r(y); return !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top) }, [a, b])
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [name, opts] of [['phone', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${name}: three views offered`, (await page.locator('[data-rv-view]').count()) === 3)
    const heads = await page.locator('[data-rv-section] h3').allInnerTexts()
    check(`${name}: My Resources first, then Suggested by others`, heads[0] === 'My Resources' && heads[1] === 'Suggested by others')
    check(`${name}: Dune sits under Suggested by others`, (await page.locator('[data-rv-section="suggested"] [data-rv-item="i2"]').count()) === 1)
    check(`${name}: view bar does not overlap the first section`, !(await boxes(page, '.rv-switch', '.rv-chips + .rv-section, [data-rv-section="mine"]')))
    await page.screenshot({ path: `${SHOTS}/resource-views-${name}-list.png` })
    // kind filter (behind the Filters expander)
    check(`${name}: filters folded by default`, (await page.locator('[data-rv-kind]').count()) === 0)
    await page.locator('[data-rv-filters-toggle]').click(); await page.waitForTimeout(200)
    await page.locator('[data-rv-kind="book"]').click(); await page.waitForTimeout(300)
    check(`${name}: Books chip keeps only the books`, (await page.locator('[data-rv-item]').count()) === 2 && (await page.locator('[data-rv-protected]').count()) === 0)
    check(`${name}: off chips are struck through (aria-pressed false)`, (await page.locator('[data-rv-kind="recording"]').getAttribute('aria-pressed')) === 'false' && (await page.locator('[data-rv-kind="recording"]').evaluate((n) => getComputedStyle(n).textDecorationLine.includes('line-through'))))
    await page.locator('[data-rv-kind=""]').click(); await page.waitForTimeout(300)
    // shared by + community
    await page.locator('[data-rv-shared]').selectOption('p1'); await page.waitForTimeout(300)
    check(`${name}: shared by Ada keeps Dune only`, (await page.locator('[data-rv-item]').count()) === 1)
    await page.locator('[data-rv-shared]').selectOption(''); await page.waitForTimeout(200)
    await page.locator('[data-rv-community="c1"]').click(); await page.waitForTimeout(300)
    check(`${name}: community chip filters`, (await page.locator('[data-rv-item]').count()) === 1)
    await page.locator('[data-rv-community="c1"]').click(); await page.waitForTimeout(200)
    // outliner and by person
    await page.locator('[data-rv-view="outliner"]').click(); await page.waitForTimeout(300)
    check(`${name}: outliner groups community > kind`, (await page.locator('[data-rv-community-group="c1"] [data-rv-kind-group="book"]').count()) === 1 && (await page.locator('[data-rv-community-group=""]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/resource-views-${name}-outliner.png` })
    await page.locator('[data-rv-view="person"]').click(); await page.waitForTimeout(300)
    check(`${name}: by person groups under Ada`, (await page.locator('[data-rv-person-group="p1"] h3').innerText()) === 'Ada Lovelace')
    await page.screenshot({ path: `${SHOTS}/resource-views-${name}-person.png` })
    await page.locator('[data-rv-view="list"]').click(); await page.waitForTimeout(300)
    // protected
    const prot = page.locator('[data-rv-protected="i3"]')
    check(`${name}: protected row: no share controls`, (await prot.locator('.inv-actions, .x, [data-item]').count()) === 0)
    check(`${name}: protected row: text not selectable`, (await prot.evaluate((n) => getComputedStyle(n).userSelect)) === 'none')
    check(`${name}: protected link hidden until pressed`, (await page.locator('[data-rv-link]').count()) === 0)
    await page.locator('[data-rv-link-toggle="i3"]').click(); await page.waitForTimeout(200)
    check(`${name}: press reveals that link only`, (await page.locator('[data-rv-link]').count()) === 1 && (await page.locator('[data-rv-link="i3"]').count()) === 1)
    await page.locator('[data-rv-link-toggle="i4"]').click(); await page.waitForTimeout(200)
    check(`${name}: one at a time: the second press hides the first`, (await page.locator('[data-rv-link]').count()) === 1 && (await page.locator('[data-rv-link="i4"]').count()) === 1)
    check(`${name}: protected row has no Record button (43b-D5)`, (await page.locator('[data-rv-record="i3"]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/resource-views-${name}-protected.png` })
    // recommender chip
    const sug = page.locator('[data-rv-suggest="i1"]')
    check(`${name}: "Recommended by Ada Lovelace?" suggested`, (await sug.innerText()).includes('Recommended by Ada Lovelace?'))
    await page.locator('[data-rv-accept="i1"]').click(); await page.waitForTimeout(300)
    check(`${name}: accepting stores it and the chip goes`, (await page.locator('[data-rv-suggest="i1"]').count()) === 0 && (await stored(page)).inventory.find((x) => x.id === 'i1').recommendedBy === 'p1')
    // kind select
    await page.locator('[data-rv-kind-set="i5"]').selectOption('publication'); await page.waitForTimeout(300)
    check(`${name}: kind select saves`, (await stored(page)).inventory.find((x) => x.id === 'i5').kind === 'publication')
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
