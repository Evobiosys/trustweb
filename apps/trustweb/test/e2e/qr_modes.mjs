// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 qr-modes proof (headless, dev only): PORT=5431 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node qr_modes.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  events: [{ id: 'e1', name: 'Forum Tirol', from: '2026-11-12', where: 'Innsbruck', createdAt: 1, attended: true }],
  people: [{ id: 'p2', name: 'Kaja', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, publicUsername: 'kaja', links: { signal: 'https://signal.me/#eu/kajaabc123' } }] })
try {
  for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1440, height: 900 } }]]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(500)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
    await page.locator('[data-card-qr="p2"]').scrollIntoViewIfNeeded()
    await page.locator('[data-card-qr="p2"]').click(); await page.waitForTimeout(800)
    check(`${name}: QR page opens as a page with Back`, (await page.locator('[data-page="qr-modes"] [data-page-back]').count()) === 1)
    const payload = () => page.locator('[data-qr-modes]').getAttribute('data-payload')
    check(`${name}: plain connect by default`, !(await payload()).includes('m=person'))
    check(`${name}: only the username is offered under public`, (await page.locator('[data-qr-option]').count()) === 1)
    await page.locator('[data-qr-option="username"]').check(); await page.waitForTimeout(400)
    check(`${name}: toggling the username re-renders with m=person`, (await payload()).includes('m=person'))
    check(`${name}: the choice is shown in words`, (await page.locator('[data-qr-words]').innerText()).includes("Kaja's public username"))
    await page.screenshot({ path: `${SHOTS}/${name}-qr-person.png` })
    await page.locator('[data-page-back]').click(); await page.waitForTimeout(300)
    await page.locator('button[data-card-curate]').scrollIntoViewIfNeeded()
    await page.locator('button[data-card-curate]').click(); await page.waitForTimeout(300)
    await page.locator('[data-introduce="p2"]').selectOption('one-ring-closer'); await page.waitForTimeout(200)
    check(`${name}: permission saved`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].introducePermission)) === 'one-ring-closer')
    await page.screenshot({ path: `${SHOTS}/${name}-curate-introduce.png` })
    await page.locator('[data-page="card-curate"] [data-page-back]').click(); await page.waitForTimeout(300)
    await page.locator('[data-card-qr="p2"]').scrollIntoViewIfNeeded()
    await page.locator('[data-card-qr="p2"]').click(); await page.waitForTimeout(600)
    check(`${name}: one ring closer also offers the profile`, (await page.locator('[data-qr-option]').count()) === 2)
    await page.reload(); await page.waitForTimeout(800)
    await page.locator('[data-go="events"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').evaluate((n) => n.click()); await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').evaluate((n) => n.click()); await page.waitForTimeout(300)
    await page.locator('[data-event-qr]').click(); await page.waitForTimeout(800)
    const p = await payload()
    check(`${name}: event QR holds the connect code and the event`, p.includes('connect=') && p.includes('m=event') && p.includes('#ev='))
    await page.screenshot({ path: `${SHOTS}/${name}-qr-event.png` })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
