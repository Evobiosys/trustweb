// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 share-page proof (headless, dev only) at 390x844: open Share from a Resource, pick Friend, add one @person exclusion,
 * read the preview count, Share, assert the share line exists. Invented names.
 * PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node share_page.mjs
 */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring) => ({ id, name, ring, addedAt: 1, tags: [] })
const record = JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Owner Test' }, peers: [], log: [],
  inventory: [{ id: 'it1', text: 'Cargo bike', audience: 'me', included: true, createdAt: 1 }],
  people: [person('ada', 'Ada Probe', 'friend'), person('cy', 'Cy Probe', 'close'), person('bo', 'Bo Probe', 'acquaintance'), person('di', 'Di Probe', 'friend')],
})
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
  await page.locator('nav.tabs button', { hasText: 'Resources' }).click()
  await page.locator('[data-item="it1"]').first().tap(); await page.waitForTimeout(300)
  await page.locator('[data-share-item="it1"]').tap(); await page.waitForTimeout(300)
  check('Share opens a page, not a sheet', (await page.locator('[data-page="share-page"] [data-share-page]').count()) === 1)
  check('default zone is Acquaintance', (await page.locator('[data-share-zone="acquaintance"].on').count()) === 1)
  await page.locator('[data-share-zone="friend"]').tap()
  check('Friend: Ada, Cy, Di would see it (3)', (await page.locator('[data-share-preview]').getAttribute('data-share-preview')) === '3')
  await page.locator('[data-share-input="exclude"]').fill('Ada')
  await page.locator('[data-share-suggest="person:ada"]').tap()
  check('exclusion lowers the preview to 2', (await page.locator('[data-share-preview]').getAttribute('data-share-preview')) === '2')
  await page.locator('[data-share-preview] summary').tap()
  const names = await page.locator('[data-share-names]').innerText()
  check('names under the (i): Cy and Di, not Ada', /Cy Probe/.test(names) && /Di Probe/.test(names) && !/Ada/.test(names))
  await page.screenshot({ path: `${SHOTS}/share-page.png` })
  await page.locator('[data-share-go]').tap(); await page.waitForTimeout(400)
  check('Back to the item: page closed', (await page.locator('[data-share-page]').count()) === 0)
  const shares = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).shares)
  check('one share line with zone friend and the exclusion', shares?.length === 1 && shares[0].op === 'share' && shares[0].id === 'item:it1'
    && shares[0].scope.zone === 'friend' && shares[0].scope.exclude[0] === 'person:ada')
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors.join('\n'))
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
