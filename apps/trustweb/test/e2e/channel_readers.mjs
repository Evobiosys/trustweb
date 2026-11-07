// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b channel-readers (headless, scratch record): PORT=5471 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path to playwright-core index.mjs> node channel_readers.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium

const URL = `http://127.0.0.1:${process.env.PORT ?? 5471}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
try {
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Scratch', primaryEmail: { provider: 'proton', address: 'me@proton.me' } }, peers: [], log: [], inventory: [], people: [], myChannels: { signal: '+4312345' } })), KEY)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    const rec = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY)
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(400)
    await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    const chip = page.locator('[data-readers-row="email:me@proton.me"] [data-readers]')
    await chip.scrollIntoViewIfNeeded()
    check(`${w}: primary email starts humans-only`, (await chip.getAttribute('data-readers')) === 'humans' && /Only humans read this/.test(await chip.innerText()))
    check(`${w}: primary marked personal`, /personal/.test(await page.locator('[data-readers-row="email:me@proton.me"]').innerText()))
    // 3 taps for Jakob: add ik.me, tap chip once (private AIs); proton stays humans-only
    await page.locator('[data-readers-email]').fill('japossert@ik.me')
    await page.locator('[data-readers-email-add]').click(); await page.waitForTimeout(300)
    await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    await page.locator('[data-readers-row="email:japossert@ik.me"] [data-readers]').click(); await page.waitForTimeout(300)
    await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    let r = (await rec()).channelReaders
    check(`${w}: ik.me private-ai, proton untouched`, r['email:japossert@ik.me'].readers === 'private-ai' && !r['email:me@proton.me'])
    await page.locator('[data-readers-row="email:japossert@ik.me"] [data-readers]').click(); await page.waitForTimeout(300)
    check(`${w}: chip cycles on to all AIs`, (await rec()).channelReaders['email:japossert@ik.me'].readers === 'all-ai')
    await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    await page.locator('[data-readers-block]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/channel-readers-list-${w}.png` })
    await page.locator('[data-readers-row="email:japossert@ik.me"] [data-readers-more]').click(); await page.waitForTimeout(300)
    await page.locator('[data-readers-provider="openai"]').uncheck(); await page.waitForTimeout(300)
    r = (await rec()).channelReaders['email:japossert@ik.me']
    check(`${w}: provider sheet blocks openai`, r.aiDeny?.includes('openai'))
    await page.screenshot({ path: `${SHOTS}/channel-readers-sheet-${w}.png` })
    check(`${w}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${w}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
