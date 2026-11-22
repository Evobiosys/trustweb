// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 outliner-quickadd proof (headless, stock dev server): PORT=5473 SHOTS=<dir> PW=<playwright-core index.mjs> EXE=<chromium headless shell> node outliner_quickadd.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5473}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const it = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1, ...over })
const blk = (id, text, children = []) => ({ id, text, children })
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], events: [], people: [{ id: 'p1', name: 'Test Peer', ring: 'friend', peerId: 'k1', fields: {} }],
  inventory: [
    it('r1', 'Reading list', { blocks: [blk('a', 'Books', [blk('a1', 'Dune')])] }),
    it('r2', 'Hidden talk', { kind: 'recording', protected: true, link: 'https://example.org/a' }),
  ] })
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [name, opts] of [['phone', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => { localStorage.setItem('trustweb.ui.keepcopy.offered', '1'); localStorage.setItem('trustweb.v1.me', r) }, record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-item="r1"]').first().click(); await page.waitForTimeout(400)
    const q = page.locator('[data-ol-quick]')
    check(`${name}: the outline has the quick-add input`, (await q.count()) === 1)
    await q.click(); await page.keyboard.type('Read #'); await page.waitForTimeout(200)
    check(`${name}: # lists tag suggestions as chips`, (await page.locator('[data-ol-quick-hit]').count()) >= 1)
    await page.screenshot({ path: `${SHOTS}/outliner-quickadd-${name}.png` })
    await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    const hit = await page.locator('[data-ol-quick]').inputValue()
    check(`${name}: Enter takes the first suggestion (${hit.trim()})`, /^Read #\S+ $/.test(hit))
    await page.keyboard.type('@test'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    check(`${name}: @ suggests the connected person`, (await page.locator('[data-ol-quick]').inputValue()).includes('@Test Peer'))
    await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    let rec = await stored(page)
    const top = rec.inventory[0].blocks
    check(`${name}: Enter adds the line at the end, quick box emptied and still focused`, top.length === 2 && top[1].text.startsWith('Read #') && (await q.inputValue()) === '' && await page.evaluate(() => document.activeElement?.hasAttribute('data-ol-quick')))
    check(`${name}: the line shows its tag and person as chips`, (await page.locator(`[data-ol-chips="${top[1].id}"] .chip`).count()) === 2)
    await page.keyboard.type('Child'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    await page.keyboard.press('Tab'); await page.waitForTimeout(200)
    await page.keyboard.type('Sub'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    rec = await stored(page)
    let read = rec.inventory[0].blocks[1]
    check(`${name}: Tab indents the last added line, Enter keeps adding below it (same level)`, rec.inventory[0].blocks.length === 2 && read.children.map((k) => k.text).join() === 'Child,Sub')
    await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(300)
    rec = await stored(page)
    check(`${name}: Shift+Tab outdents it after its parent`, rec.inventory[0].blocks.map((k) => k.text).slice(-1)[0] === 'Sub' && rec.inventory[0].blocks[1].children.length === 1)
    check(`${name}: the other outline tools still work`, (await page.locator('[data-ol-tool="indent"]').count()) === 1)
    check(`${name}: no page errors`, errors.length === 0)
    await page.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
