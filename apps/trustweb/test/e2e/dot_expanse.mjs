// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: drop a dot on the ⛶ control, tap it, bring back. PORT=5462 EXE=<chromium> PW=<playwright-core index.mjs> node dot_expanse.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5462}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Kaja', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000 }, { id: 'p3', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000 }] })
try {
  for (const width of [1280, 360]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
    const ctl = page.locator('[data-expanse-drop]').first()
    check(`${width}: control present`, await ctl.isVisible())
    check(`${width}: no badge yet`, (await page.locator('[data-expanse-count]').count()) === 0)
    const dot = page.locator('[data-pid="p2"]:visible').first()
    const d = await dot.boundingBox(); const c = await ctl.boundingBox()
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2); await page.mouse.down()
    await page.mouse.move(d.x + d.width / 2 + 10, d.y + d.height / 2 + 10, { steps: 3 })
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 })
    check(`${width}: target highlights`, await ctl.evaluate((n) => n.classList.contains('drop')))
    await page.mouse.up(); await page.waitForTimeout(400)
    check(`${width}: dot gone from rings`, (await page.locator('[data-pid="p2"]:visible').count()) === 0)
    check(`${width}: badge shows 1`, (await page.locator('[data-expanse-count]').first().getAttribute('data-expanse-count')) === '1')
    check(`${width}: record keeps ring`, await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return r.expanse?.[0] === 'p2' && r.people.find((p) => p.id === 'p2').ring === 1 }))
    await ctl.click(); await page.waitForTimeout(300)
    check(`${width}: sheet lists Kaja`, (await page.locator('[data-expanse-restore-one="p2"]').count()) === 1)
    check(`${width}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.locator('[data-expanse-restore-one]').first().click(); await page.waitForTimeout(400)
    check(`${width}: dot back`, (await page.locator('[data-pid="p2"]:visible').count()) >= 1)
    check(`${width}: badge gone`, (await page.locator('[data-expanse-count]').count()) === 0)
    check(`${width}: no page errors`, errors.length === 0)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
