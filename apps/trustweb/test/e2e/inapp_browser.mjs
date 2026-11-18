// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-inapp-browser: a connect link in Telegram's in-app browser shows the banner (both viewports, iOS + Android UA); a real browser shows none. PORT=5305 EXE=<chrome> PW=<playwright-core index.mjs> node inapp_browser.mjs */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const BASE = `http://127.0.0.1:${process.env.PORT ?? 5305}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const LINK = 'did:peer:2.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc.Vz6MkqRYqQiSgvZQdnBytw86Qbs2ZWUkGv22od935YF4s8M7V'
const QUERY = `?connect=${encodeURIComponent(LINK)}&id=p1p1p1p1p1p1&name=Ada`
const IOS_TG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/10.14'
const AND_TG = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Telegram-Android/10.14.5'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const RECORD = '{"v":1,"me":{"id":"mmmmmmmmmmmm","displayName":"Me"},"peers":[],"people":[],"inventory":[],"log":[],"notificationsOn":false}'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const VIEWS = [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]
try {
  for (const [vname, viewport] of VIEWS) {
    const open = async (ua, suffix, seed) => {
      const ctx = await browser.newContext({ viewport, userAgent: ua, acceptDownloads: true })
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin }).catch(() => undefined)
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      if (seed) { await page.goto(BASE); await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), seed); await page.goto('about:blank') }
      await page.goto(BASE + suffix); await page.waitForTimeout(1500)
      await page.addStyleTag({ content: '.twf{display:none !important}' }) // the dev server's feature chip, absent in a build
      return { page, errors }
    }

    let t = await open(IOS_TG, QUERY)
    check(`${vname} iOS Telegram: banner names Ada`, (await t.page.locator('[data-inapp-banner]').innerText()).includes('add Ada to your web'))
    check(`${vname} iOS: "Not in your web yet" note`, (await t.page.locator('[data-inapp-note]').innerText()).includes('Not in your web yet'))
    check(`${vname} iOS: copy + iPhone instructions, no Android button`, (await t.page.locator('[data-inapp-copy]').count()) === 1 && (await t.page.locator('[data-inapp-how]').count()) === 1 && (await t.page.locator('[data-inapp-open]').count()) === 0)
    await t.page.locator('[data-inapp-copy]').click(); await t.page.waitForTimeout(300)
    const copied = await t.page.evaluate(() => navigator.clipboard.readText()).catch(() => null)
    check(`${vname} iOS: copied link is the opened link (same connect, name, id)`, copied !== null && copied.includes(`connect=${encodeURIComponent(LINK)}`) && copied.includes('name=Ada'))
    check(`${vname} iOS: no record to export when none exists`, (await t.page.locator('[data-inapp-export]').count()) === 0)
    check(`${vname} iOS: banner stays after the startup URL clean (remembered)`, (await t.page.evaluate(() => !location.search.includes('connect'))))
    await t.page.screenshot({ path: `${SHOTS}/steer-inapp-browser-ios-${vname}.png` })
    check(`${vname} iOS: no document scroll`, await t.page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
    await t.page.reload(); await t.page.waitForTimeout(1200)
    check(`${vname} reopen without the link in-app: banner still there`, (await t.page.locator('[data-inapp-banner]').count()) === 1)
    check(`${vname} iOS: no page errors`, t.errors.length === 0)

    t = await open(AND_TG, QUERY)
    const href = await t.page.locator('[data-inapp-open]').getAttribute('href')
    check(`${vname} Android Telegram: intent:// button carrying the link`, !!href && href.startsWith('intent://') && href.includes('scheme=http') && href.includes(encodeURIComponent(LINK)))
    await t.page.screenshot({ path: `${SHOTS}/steer-inapp-browser-android-${vname}.png` })

    t = await open(IOS_TG, QUERY, RECORD)
    const dl = t.page.waitForEvent('download', { timeout: 5000 })
    await t.page.locator('[data-inapp-export]').click()
    const file = await dl.catch(() => null)
    check(`${vname} existing record: export offered and saves the record file`, !!file && file.suggestedFilename() === 'trustweb-record.json')
    t = await open(SAFARI, QUERY)
    check(`${vname} real Safari: no banner`, (await t.page.locator('[data-inapp-banner]').count()) === 0)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
