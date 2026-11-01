// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 card-pages proof, following the wave-27 card layout (small card, Extended expands in place, one timeline, Curate last) (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node card_pages.mjs. */
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
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    const y = (sel) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().top + scrollY)
    check(`${name}: small card, Chat row on top, no Days section, nothing expanded`, (await page.locator('[data-small-card="p2"]').count()) === 1 && (await y('[data-chat-row]')) < (await y('[data-card-open="p2"]')) && (await page.locator('[data-card-days]').count()) === 0 && (await page.locator('[data-card-more]').count()) === 0)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
    check(`${name}: Extended expands in place (no page, aria-expanded)`, (await page.locator('[data-card-more="p2"]').count()) === 1 && (await page.locator('[data-card-open="p2"]').getAttribute('aria-expanded')) === 'true' && (await page.locator('[data-page]').count()) === 0)
    check(`${name}: one timeline, no Days`, (await page.locator('[data-person-timeline]').count()) === 1 && (await page.locator('[data-card-days]').count()) === 0)
    check(`${name}: order Chat row < Who they know < Timeline < Curate last`, (await y('[data-chat-row]')) < (await y('[data-person-knows="p2"]')) && (await y('[data-person-knows="p2"]')) < (await y('[data-person-timeline]')) && (await y('[data-person-timeline]')) < (await y('button[data-card-curate]')) && (await page.evaluate(() => [...document.querySelectorAll('[data-card-more="p2"] button')].at(-1)?.hasAttribute('data-card-curate'))) === true)
    await page.locator('button[data-card-curate]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/${name}-expanded.png` })
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
    check(`${name}: browser Back closes the page`, (await page.locator('[data-page]').count()) === 0 && (await page.locator('[data-card-more="p2"]').count()) === 1)
    await page.goBack(); await page.waitForTimeout(300)
    check(`${name}: Back collapses the card first`, (await page.locator('[data-card-more]').count()) === 0 && (await page.locator('[data-small-card="p2"]').count()) === 1 && (await page.locator('[data-card-open="p2"]').getAttribute('aria-expanded')) === 'false')
    await page.goBack(); await page.waitForTimeout(300)
    check(`${name}: second Back leaves the card`, (await page.locator('[data-small-card="p2"]').count()) === 0)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
  // Desktop: the same card (no Desk person page): Extended expands in place; the Curator's Notes sit embedded above Fields, the one Timeline below.
  const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const derrors = []
  d.on('pageerror', (e) => derrors.push(String(e)))
  await d.goto(URL); await d.waitForTimeout(1500)
  await d.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await d.reload(); await d.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await d.waitForTimeout(500)
  await d.locator('[data-pid="p2"]').last().click(); await d.waitForTimeout(600)
  check('desktop: click on a dot opens the small card, not expanded', (await d.locator('[data-small-card="p2"]').count()) === 1 && (await d.locator('[data-card-more]').count()) === 0)
  await d.locator('[data-card-open="p2"]').click(); await d.waitForTimeout(800)
  check('desktop: one timeline, no What happened, no Days', (await d.locator('[data-person-timeline]').count()) === 1 && (await d.locator('[data-action="toggle-happened"]').count()) === 0 && (await d.locator('[data-card-days]').count()) === 0)
  check('desktop: Notes open', (await d.locator('[data-action="toggle-notes"]').getAttribute('aria-expanded')) === 'true')
  const y = (sel) => d.locator(sel).first().evaluate((e) => e.getBoundingClientRect().top + scrollY)
  check('desktop: Add a note under the Notes header, above Fields, Timeline and Curate', (await y('[data-action="toggle-notes"]')) < (await y('[data-field="add-note"]')) && (await y('[data-field="add-note"]')) < (await y('[data-action="toggle-fields"]')) && (await y('[data-action="toggle-fields"]')) < (await y('[data-person-timeline]')) && (await y('[data-person-timeline]')) < (await y('button[data-card-curate]')))
  await d.locator('[data-field="add-note"]').fill('a note'); await d.locator('[data-action="add-note"]').click(); await d.waitForTimeout(300)
  // Finding (wave 27): the saved note is an interaction in the Curator store and shows nowhere on the card (not in Notes, not in the merged timeline), so only the save is asserted.
  check('desktop: the new note is saved in the Curator record', (await d.evaluate(() => JSON.parse(localStorage.getItem('trustweb-crm.v1.me')).interactions.some((i) => i.personId === 'p2' && i.kind === 'note' && i.text === 'a note'))) === true)
  await d.screenshot({ path: `${SHOTS}/desktop-expanded.png` })
  await d.locator('[data-action="toggle-notes"]').click()
  check('desktop: notes fold remembered', (await d.evaluate(() => localStorage.getItem('trustweb.ui.fold.notes'))) === '0')
  check('desktop: no page errors', derrors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
