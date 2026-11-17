// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-placement (headless, stock dev only): PORT=5295 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node steer_ask_placement.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5295}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const REC = { v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'a1', name: 'Anna Huber', context: '', ring: 'friend', metAt: 1, lines: [] }], peers: [], chats: {}, inventory: [], wantsToConnect: [], notifInbox: [], log: [], events: [], missedPopupOff: true }
const SCREENS = [['web', 'Web'], ['inventory', 'Resources']]
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    for (const withAsk of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(URL); await page.waitForTimeout(1200)
      const rec = withAsk ? { ...REC, uiBar: { order: ['web', 'chat', 'ask', 'events', 'inventory'], hidden: [], orderVersion: 2, profile: 'custom' } } : REC
      await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), rec)
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
      for (const [id, name] of SCREENS) {
        await page.evaluate((i) => document.querySelector(`[data-go="${i}"]`)?.click(), id); await page.waitForTimeout(500)
        const tag = `${w}: ${name}${withAsk ? ' (Ask in bar)' : ''}`
        check(`${tag}: no Ask control in the header (the sparkle is the AI button and stays)`, (await page.locator('.hdr [data-open-query]').count()) === 0 && (await page.locator('.hdr [data-ai-button]').count()) === 1)
        const pill = page.locator('.query-fab[data-open-query]:visible')
        if (withAsk) {
          check(`${tag}: overlay pill hidden`, (await pill.count()) === 0)
          check(`${tag}: bar carries the Ask item`, (await page.locator('.phone.ask-in-bar').count()) === 1 && (await page.locator('.tabs [data-go="ask"]:visible').count()) >= 1)
        } else {
          const b = await pill.first().boundingBox().catch(() => null)
          check(`${tag}: overlay pill floats bottom right`, !!b && b.y > h * 0.5 && b.x + b.width > w * 0.5, JSON.stringify(b))
        }
        await page.screenshot({ path: `${SHOTS}/steer-ask-placement-${name.toLowerCase()}${withAsk ? '-bar' : ''}-${w}.png` })
      }
      check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
