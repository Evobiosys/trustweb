// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 share-wording proof (headless, dev only): turquoise count heading, typeahead modes, tag chip hover list (3 + more...),
 * click -> community list page, a profile saved and applied. Invented names.
 * PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> VIEW=mobile|desktop node share_wording.mjs
 */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const desktop = process.env.VIEW === 'desktop'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, addedAt: 1, tags: [], ...(fields && { fields }) })
const record = JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Owner Test' }, peers: [], log: [],
  inventory: [{ id: 'it1', text: 'Cargo bike', audience: 'me', included: true, createdAt: 1 }],
  people: [person('ada', 'Ada Probe', 'friend', { garden: 'true' }), person('cy', 'Cy Probe', 'close', { garden: 'true' }), person('bo', 'Bo Probe', 'acquaintance', { garden: 'true' }),
    person('di', 'Di Probe', 'friend', { garden: 'true' }), person('ed', 'Ed Probe', 'friend')],
})
try {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t) }, [record, JSON.stringify([{ id: 'garden', colour: '#00aa00', label: 'garden' }])])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  const tap = (loc) => (desktop ? loc.click() : loc.tap())
  await tap(page.locator('nav.tabs button', { hasText: 'Resources' }))
  await tap(page.locator('[data-item="it1"]').first()); await page.waitForTimeout(300)
  await tap(page.locator('[data-share-item="it1"]')); await page.waitForTimeout(300)
  check('count heading is turquoise', (await page.locator('.share-count').evaluate((e) => getComputedStyle(e).color)) === 'rgb(19, 134, 126)')
  const inp = page.locator('[data-share-input="include"]')
  await inp.fill('gard')
  check('no prefix offers the tag', (await page.locator('[data-share-suggest="tag:garden"]').count()) === 1)
  await inp.fill('@ada')
  check('@ offers the person only', (await page.locator('[data-share-suggest]').count()) === 1 && (await page.locator('[data-share-suggest="person:ada"]').count()) === 1)
  await inp.fill('#gard'); await tap(page.locator('[data-share-suggest="tag:garden"]'))
  const chip = page.locator('[data-share-chip-wrap="tag:garden"]')
  if (desktop) await chip.hover(); else { const b = await chip.boundingBox(); await page.touchscreen.tap(b.x + 1, b.y + 1).catch(() => undefined) }
  if (!desktop) { await page.evaluate(() => document.querySelector('[data-share-chip-wrap]').dispatchEvent(new Event('contextmenu', { bubbles: true }))) }
  await page.waitForTimeout(300)
  const peek = chip.locator('.share-peek')
  check('hover list shows 3 people and more...', (await peek.locator('div').count()) === 3 && (await peek.locator('[data-share-more]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/share-${desktop ? 'desktop' : 'mobile'}-hover.png` })
  await peek.locator('[data-share-more]').dispatchEvent('click')
  check('more... shows all 4', (await peek.locator('div').count()) === 4)
  await page.fill('[data-share-profile-name]', 'Garden crew'); await tap(page.locator('[data-share-profile-save]')); await page.waitForTimeout(200)
  check('profile saved', (await page.locator('[data-share-profile]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/share-${desktop ? 'desktop' : 'mobile'}-page.png`, fullPage: false })
  await page.locator('[data-share-chip="tag:garden"]').dispatchEvent('click'); await page.waitForTimeout(300)
  check('click on the tag opens the community list page', (await page.locator('[data-page="share-tag-list"] .share-member').count()) === 4)
  await page.screenshot({ path: `${SHOTS}/share-${desktop ? 'desktop' : 'mobile'}-community.png` })
  await page.locator('[data-page="share-tag-list"] [data-page-back]').dispatchEvent('click'); await page.waitForTimeout(300)
  check('Back returns to the Share page', (await page.locator('[data-share-page]').count()) === 1)
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors.join('\n'))
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
