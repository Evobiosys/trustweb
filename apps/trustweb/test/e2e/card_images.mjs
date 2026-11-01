// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 card-images proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node card_images.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [
    { id: 'p2', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, knows: ['p3', 'p4'] },
    { id: 'p3', name: 'Alexandra Montgomery-Smith', ring: 2, lines: [], context: 'Met at the fair in Graz', generalNote: 'Runs the seed library', metAt: Date.now() },
    { id: 'p4', name: 'Archived Ann', ring: 2, lines: [], context: 'x', metAt: Date.now() },
  ] })
const shrunk = async (page) => Buffer.from((await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800
  const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 1200, 800); g.fillStyle = '#fc3'; g.fillRect(300, 200, 600, 400)
  return c.toDataURL('image/jpeg', 0.95)
})).split(',')[1], 'base64')
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
    // p4 is archived in the Curator: simulated by the hidden-ids store when present; otherwise it stays listed (reported below).
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    check(`${name}: initials avatar is a button on the small card`, (await page.locator('[data-small-card="p2"] [data-card-face="p2"] .ava').count()) === 1)
    check(`${name}: menu is closed until the picture is pressed`, await page.locator('[data-card-face-menu]').isHidden())
    await page.locator('[data-card-face="p2"]').click()
    check(`${name}: menu offers Take photo and Choose file`, (await page.locator('[data-card-face-take]').isVisible()) && (await page.locator('[data-card-face-choose]').isVisible()) && (await page.locator('[data-card-face-input="camera"]').getAttribute('capture')) === 'user')
    await page.locator('[data-card-face-input="file"]').setInputFiles({ name: 'face.jpg', mimeType: 'image/jpeg', buffer: await shrunk(page) })
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].image, null, { timeout: 8000 })
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].image)
    console.log(`INFO  ${name}: stored image ${stored.length} chars`)
    check(`${name}: stored as a small JPEG data URL under the cap`, /^data:image\/jpeg;base64,/.test(stored) && stored.length <= 40_000)
    check(`${name}: the small card shows the picture, not the initial`, await page.locator('[data-card-face="p2"] .ava').evaluate((e) => e.style.background.includes('data:image/jpeg') && e.textContent === ''))
    await page.screenshot({ path: `${SHOTS}/${name}-card-small.png` })
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
    check(`${name}: still shown when extended`, await page.locator('[data-card-face="p2"] .ava').evaluate((e) => e.style.background.includes('data:image/jpeg')))
    const chip = page.locator('[data-knows-chip="p3"]')
    await chip.scrollIntoViewIfNeeded()
    check(`${name}: who-they-know shows the short name`, (await page.locator('[data-knows-open="p3"]').innerText()) === 'Alexandra')
    check(`${name}: entry is collapsed at first`, await page.locator('[data-knows-peek="p3"]').isHidden())
    if (name === 'desktop') await chip.hover()
    else { const b = await chip.boundingBox(); await page.mouse.move(b.x + 20, b.y + 10); await chip.dispatchEvent('contextmenu') }
    await page.waitForTimeout(200)
    check(`${name}: hover or long press expands image and note`, (await page.locator('[data-knows-peek="p3"]').isVisible()) && (await page.locator('[data-knows-peek="p3"]').innerText()).includes('Runs the seed library') && (await page.locator('[data-knows-peek="p3"] .ava').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-knows-peek.png` })
    if (name === 'phone') await page.locator('[data-knows-open="p3"]').tap(); else await page.locator('[data-knows-open="p3"]').click()
    await page.waitForTimeout(500)
    check(`${name}: press opens that person's card`, (await page.locator('[data-small-card="p3"]').count()) === 1)
    await page.goto(URL); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(800)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-face="p2"]').click(); await page.locator('[data-card-face-remove]').click(); await page.waitForTimeout(300)
    check(`${name}: Remove returns to the initials`, !(await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].image)))
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
