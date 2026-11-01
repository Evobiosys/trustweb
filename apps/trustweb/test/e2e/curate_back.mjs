// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 curate-back proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node curate_back.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Kaja', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, peerId: 'x1' }] })
try {
  for (const [name, opts] of [
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
    const add = page.locator('[data-no-messenger-add="p2"]')
    check(`${name}: the line offers "add" (underlined button)`, (await add.count()) === 1 && (await add.evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'underline' && /No messenger link from Kaja yet\. If they share one, it shows here, or add one\./.test(await page.locator('[data-no-messenger]').innerText()))
    if (name === 'phone') await add.tap(); else await add.click()
    check(`${name}: tapping "add" focuses the link field`, await page.evaluate(() => document.activeElement?.matches('[data-link-input]') ?? false))
    await page.screenshot({ path: `${SHOTS}/${name}-add-link.png` })
    await page.locator('[data-link-input]').fill('https://signal.me/#p/+436601234567'); await page.locator('[data-link-save]').click(); await page.waitForTimeout(300)
    check(`${name}: link saved`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].links?.signal)) === 'https://signal.me/#p/+436601234567')
    await page.locator('button[data-card-curate]').scrollIntoViewIfNeeded()
    await page.locator('button[data-card-curate]').click(); await page.waitForTimeout(300)
    check(`${name}: Curate opens a page`, (await page.locator('[data-page="card-curate"]').count()) === 1)
    if (name === 'phone') await page.touchscreen.tap(...(await page.locator('[data-page-back]').boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])))
    else await page.locator('[data-page-back]').click()
    await page.waitForTimeout(60)
    check(`${name}: Back closes the Curate page at once`, (await page.locator('[data-page]').count()) === 0)
    check(`${name}: one Back leaves the card open underneath`, (await page.locator('[data-card-days="p2"]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
