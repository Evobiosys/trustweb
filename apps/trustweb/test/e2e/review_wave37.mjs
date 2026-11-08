// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 37 review: PORT=<p> EXE=<chromium headless shell> PW=<playwright-core index.mjs> SHOTS=<dir> node test/e2e/review_wave37.mjs (stock dev server, no dev record).
const pw = await import(process.env.PW)
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT}/`
const SHOTS = process.env.SHOTS
const DAY = 86_400_000
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const noSide = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('.sheet, [data-sheet], .phone')].every((e) => e.scrollWidth <= e.clientWidth + 1))
try {
  for (const [name, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: vp })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const mk = (id, ring, age, o = {}) => ({ id, name: `P ${id}`, ring, lines: [], context: '', metAt: Date.now() - age, fields: {}, ...o })
    const people = [...Array.from({ length: 8 }, (_, i) => mk(`f${i}`, 'friend', (i + 2) * DAY)), ...Array.from({ length: 8 }, (_, i) => mk(`a${i}`, 'acquaintance', 3_600_000 * (i + 1)))]
    { const d = new Date(); people[0].fields = { birthday: `--${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } }
    const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)

    const offer = page.locator('.demo-friends button', { hasText: 'No thanks' })
    if (await offer.count()) { await offer.first().click(); await page.waitForTimeout(6500) }
    // header: brand mark left, then search, AI, eye in that order
    const order = await page.evaluate(() => [...document.querySelectorAll('.hdr .hdr-right > *')].map((n) => (n.matches('.web-search-btn') ? 'search' : n.matches('[data-ai-button]') ? 'ai' : n.matches('.view-menu-btn') || n.querySelector('.view-menu-btn') ? 'eye' : 'x')).filter((k) => k !== 'x'))
    check(`${name}: header order search, AI, eye`, JSON.stringify(order.slice(0, 3)) === '["search","ai","eye"]')
    check(`${name}: brand mark top-left`, (await page.locator('.hdr .hdr-left [data-brand-mark]').count()) === 1)
    check(`${name}: no "All people as a table" button`, (await page.locator('.web-view-row button[data-view="complete"]').count()) === 0)
    check(`${name}: birthday banner shows`, (await page.locator('[data-birthday-notice]:not([hidden])').count()) === 1 || (console.log('notice:', await page.locator('.demo-friends').innerText().catch(() => '?')), false))
    await page.screenshot({ path: `${SHOTS}/review-app-${name}-web.png` })
    check(`${name}: Web no sideways scroll`, await noSide(page))

    // ring-rule review fix: a person added after a manual move still shows
    const drawn = () => page.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => n.dataset.pid).sort())
    const nb = await page.locator('.rings-wrap [data-pid="f4"]').boundingBox()
    const ring = await page.locator('.rings-wrap circle[data-ring="acquaintance"]').boundingBox()
    if (nb && ring) {
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down()
      await page.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
      await page.mouse.move(ring.x + ring.width / 2 + 10, ring.y + 1, { steps: 10 })
      await page.mouse.up(); await page.waitForTimeout(3000)
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).uiRings?.shown)
    check(`${name}: sticky set saved with its time`, Boolean(saved?.ids?.length) && typeof saved?.at === 'number')
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.people.push({ id: 'n1', name: 'P new', ring: 'friend', lines: [], context: '', metAt: Date.now(), fields: {} }); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)
    check(`${name}: newcomer n1 drawn after the move`, (await drawn()).includes('n1'))
    check(`${name}: hidden friend f5 still not drawn (sticky)`, !(await drawn()).includes('f5'))

    // AI button without an endpoint -> plan cards
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(800)
    check(`${name}: three plan cards`, (await page.locator('[data-ai-plan]').count()) === 3)
    await page.screenshot({ path: `${SHOTS}/review-app-${name}-plans.png` })
    check(`${name}: plans no sideways scroll`, await noSide(page))
    const search = page.locator('[data-settings-search]')
    await search.fill('birthday'); await page.waitForTimeout(300)
    check(`${name}: settings search keeps Birthday reminders`, await page.locator('[data-birthday-reminders]').isVisible())
    await page.screenshot({ path: `${SHOTS}/review-app-${name}-settings-search.png` })
    check(`${name}: settings search no sideways scroll`, await noSide(page))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await page.goto(URL); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)

    // Table via the eye
    await page.locator('.view-menu-btn').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-view-drop] [data-view="complete"]').click(); await page.waitForTimeout(600)
    check(`${name}: Table opens with Birthdays chip`, (await page.locator('[data-cv-birthdays]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/review-app-${name}-table.png` })
    check(`${name}: Table no sideways scroll`, await noSide(page))

    // a card
    await page.locator('[data-cv-open]').first().click(); await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/review-app-${name}-card.png` })
    check(`${name}: card no sideways scroll`, await noSide(page))
    check(`${name}: theme not dark-forced`, await page.evaluate(() => document.documentElement.dataset.theme !== 'dark'))
    check(`${name}: no page errors`, errors.length === 0 || (console.log(errors), false))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
