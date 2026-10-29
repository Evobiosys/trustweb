// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 card-pages proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node card_pages.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000 }] })
try {
  for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    check(`${name}: Days section open under the name`, (await page.locator('[data-card-days="p2"] .days-body:not([hidden])').count()) === 1)
    await page.locator('[data-card-days="p2"] [data-days-toggle]').click()
    check(`${name}: Days fold remembered`, (await page.evaluate(() => localStorage.getItem('trustweb.ui.fold.days'))) === '0')
    await page.locator('[data-card-days="p2"] [data-days-toggle]').click()
    check(`${name}: Connect is a link-styled button, panel hidden`, (await page.locator('[data-connect-first="p2"]').count()) === 1 && (await page.locator('[data-connect-panel]').isHidden()))
    await page.locator('[data-connect-first="p2"]').click()
    await page.waitForFunction(() => /^https?:\/\//.test(document.querySelector('[data-connect-link]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => undefined)
    check(`${name}: panel shows a bare link`, /^https?:\/\//.test(await page.locator('[data-connect-link]').innerText()))
    await page.locator('[data-add-link="signal"]').click()
    await page.locator('[data-link-input="signal"]').fill('javascript:alert(1)'); await page.locator('[data-link-save]').click()
    check(`${name}: junk link refused`, !(await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].links)))
    await page.locator('[data-link-input="signal"]').fill('https://signal.me/#p/+436601234567'); await page.locator('[data-link-save]').click(); await page.waitForTimeout(200)
    check(`${name}: link saved and shown`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].links.signal)) === 'https://signal.me/#p/+436601234567' && (await page.locator('[data-card-link="signal"]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-connect.png` })
    await page.locator('[data-remove-link="signal"]').click()
    check(`${name}: remove clears only the link`, (await page.evaluate(() => 'links' in JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0])) === false)
    await page.locator('button[data-card-curate]').scrollIntoViewIfNeeded()
    await page.locator('button[data-card-curate]').click(); await page.waitForTimeout(300)
    check(`${name}: Curate opens a page`, (await page.locator('[data-page="card-curate"] [data-block-person]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-curate-page.png` })
    await page.goBack(); await page.waitForTimeout(300)
    check(`${name}: browser Back closes the page`, (await page.locator('[data-page]').count()) === 0 && (await page.locator('[data-card-days="p2"]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
  // Desktop: the Desk's person page (crm) carries Days under the header, folding Notes / What happened, newest note on top, "Not now".
  const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const derrors = []
  d.on('pageerror', (e) => derrors.push(String(e)))
  await d.goto(URL); await d.waitForTimeout(1500)
  await d.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await d.reload(); await d.waitForTimeout(500)
  await d.locator('[data-pid="p2"]').last().click(); await d.waitForTimeout(600)
  check('desktop: Days under the header, open', (await d.locator('[data-part="days"] .days-day').count()) >= 1)
  check('desktop: What happened folded by default, Notes open', (await d.locator('[data-action="toggle-happened"]').getAttribute('aria-expanded')) === 'false' && (await d.locator('[data-action="toggle-notes"]').getAttribute('aria-expanded')) === 'true')
  check('desktop: Keep in touch says Not now', (await d.locator('select option', { hasText: 'Not now' }).count()) >= 1 && (await d.locator('select option', { hasText: 'Never' }).count()) === 0)
  const y = async (sel) => (await d.locator(sel).boundingBox()).y
  await d.locator('[data-field="add-note"]').fill('a note'); await d.locator('[data-action="add-note"]').click(); await d.waitForTimeout(300)
  check('desktop: Add a note sits under the Notes header and above What happened', (await y('[data-action="toggle-notes"]')) < (await y('[data-field="add-note"]')) && (await y('[data-field="add-note"]')) < (await y('[data-action="toggle-happened"]')))
  await d.locator('[data-action="toggle-happened"]').click(); await d.waitForTimeout(200)
  check('desktop: the new note shows under What happened', (await d.locator('[data-screen="person"]').innerText()).includes('a note'))
  await d.screenshot({ path: `${SHOTS}/desktop-person.png` })
  await d.locator('[data-action="toggle-notes"]').click()
  check('desktop: notes fold remembered', (await d.evaluate(() => localStorage.getItem('trustweb.ui.fold.notes'))) === '0')
  check('desktop: no page errors', derrors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
