// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 support-delivery proof (headless): PORT=5441 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node support_delivery.mjs. Synthetic record. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5441}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const EMAIL_FIELD = 'Bxw7k4FWptqp'
const extra = [
  { channels: { signal: '+436601111111' } }, { channels: { whatsapp: '+436602222222' } }, { channels: { signal: '+436603333333' } },
  { fields: { [EMAIL_FIELD]: 'anna@example.org' } }, { fields: { [EMAIL_FIELD]: 'ben@example.org' } }, {},
]
const people = extra.map((e, i) => ({ id: `p${i}`, name: `Person ${i}`, ring: 'closest', lines: [], context: '', metAt: Date.now() - i * 86_400_000, peerId: `peer${i}`, fields: {}, ...e }))
const peers = people.map((p) => ({ id: p.peerId, displayName: p.name }))
const hide = '.twf, .twf-ok, .twp { display: none !important }'
try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null } })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers, log: [], inventory: [], people }))
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-variation="iyg-support"]').click(); await page.waitForTimeout(600)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    await page.locator('[data-support-primary]').click(); await page.waitForTimeout(600)
    await page.locator('[data-support-note]').fill('Hard week.')
    await page.locator('[data-support-send]').click(); await page.waitForTimeout(800)
    check(`${name}: the delivery sheet opens after Send`, await page.locator('[data-delivery]').isVisible())
    const sum = await page.locator('[data-delivery-summary]').innerText()
    check(`${name}: summary "${sum}"`, sum === '6 in the app, 2 via Signal, 1 via WhatsApp, 2 by e-mail')
    check(`${name}: one next button per messenger group, one mail button`, (await page.locator('[data-delivery-next]').count()) === 2 && (await page.locator('[data-delivery-mail]').count()) === 1)
    check(`${name}: nothing opened yet (never bulk-open)`, (await page.evaluate(() => window.__opened.length)) === 0)
    await page.screenshot({ path: `${SHOTS}/support-delivery-${name}-1-sheet.png` })
    await page.locator('[data-delivery-next="whatsapp"]').click(); await page.waitForTimeout(300)
    const opened = await page.evaluate(() => window.__opened)
    check(`${name}: WhatsApp opens one link with the text prefilled`, opened.length === 1 && opened[0].startsWith('https://wa.me/436602222222?text=') && decodeURIComponent(opened[0]).includes('Hard week.'))
    check(`${name}: WhatsApp group done after its one person`, (await page.locator('[data-delivery-group="whatsapp"][data-delivery-done]').count()) === 1)
    await page.locator('[data-delivery-next="signal"]').click(); await page.waitForTimeout(300)
    check(`${name}: Signal moves to the next person (one at a time)`, (await page.locator('[data-delivery-next="signal"]').count()) === 1 && /2 of 2/.test(await page.locator('[data-delivery-group="signal"]').innerText()))
    await page.screenshot({ path: `${SHOTS}/support-delivery-${name}-2-next.png` })
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.locator('[data-delivery-close]').click(); await page.waitForTimeout(500)
    const line = await page.locator('[data-support-line]').innerText()
    check(`${name}: receipt: sent via WhatsApp / Signal with time, not "here"`, /Sent via WhatsApp at/.test(line) && /Sent via Signal at/.test(line) && /Nobody has answered yet/.test(line))
    await page.screenshot({ path: `${SHOTS}/support-delivery-${name}-3-receipt.png` })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
