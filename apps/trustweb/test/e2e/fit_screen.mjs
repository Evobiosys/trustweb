// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 22 fit-screen guard (headless): the page itself never scrolls, on phones and short desktop windows, on every main page.
 *  PORT=5410 node fit_screen.mjs (a dev server; with a TW_DEV_RECORD server add DEV=1 to skip seeding). PW_CORE=<path to playwright-core/index.mjs> and EXE=<chromium headless shell> if the defaults are not installed.
 *  Fails when documentElement/body scrollHeight > innerHeight or window.scrollTo moves the page; prints the overflowing element. */
const { chromium } = await import(process.env.PW_CORE ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5410}/`
const VIEWPORTS = [[844, 390, true], [667, 375, true], [540, 960, true], [481, 900, true], [390, 844, true], [360, 780, true], [390, 664, true], [768, 1024, false], [600, 800, false], [1024, 768, false], [1440, 900, false], [1280, 720, false], [1440, 700, false]]
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
const REC = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], people: [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'friend'), P('c1', 'Clara Moser', 'close')] }
const click = (sel) => async (page) => { await page.locator(sel).first().click({ timeout: 4000 }) }
const PAGES = {
  start: null,
  web: click('.tab[data-go=web]'),
  resources: click('.tab[data-go=inventory]'),
  curator: click('.search-btn'),
  settings: click('.hdr-btn[aria-label=Settings]'),
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const measure = (page) => page.evaluate(() => {
  const d = document.documentElement, ih = innerHeight
  window.scrollTo(0, 99999); d.scrollTop = 99999; document.body.scrollTop = 99999
  const moved = Math.max(scrollY, d.scrollTop, document.body.scrollTop)
  let culprit = ''
  if (d.scrollHeight > ih || document.body.scrollHeight > ih) {
    let worst = null
    for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.height && r.bottom > ih + 1 && (!worst || r.bottom > worst.b)) worst = { b: r.bottom, e } }
    if (worst) culprit = `${worst.e.tagName.toLowerCase()}.${String(worst.e.className).trim().replace(/\s+/g, '.')} bottom=${Math.round(worst.b)}`
  }
  return { ih, html: d.scrollHeight, body: document.body.scrollHeight, moved, culprit }
})
try {
  for (const [w, h, mobile] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    if (!process.env.DEV) { await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC); await page.reload() }
    await page.addStyleTag({ content: '.twf { display: none !important }' }); await page.waitForTimeout(800)
    // from 900 px the Desk fills the window; the stored 'phone' view (the "Show phone version" pill) brings the phone frame back, so both get measured
    const toPhone = async () => { await page.evaluate(() => localStorage.setItem('trustweb.ui.desktop', 'phone')); await page.reload(); await page.addStyleTag({ content: '.twf { display: none !important }' }); await page.waitForTimeout(800) }
    for (const [name, go] of w >= 900 ? [...Object.entries(PAGES).slice(0, 1).map(([n, g]) => [`desk-${n}`, g]), ...Object.entries(PAGES).map(([n, g]) => [`phone-${n}`, async (pg) => { await toPhone(); if (g) await g(pg) }])] : Object.entries(PAGES)) {
      try { if (go) { await go(page); await page.waitForTimeout(900) } } catch (e) { console.log(`SKIP  ${w}x${h} ${name} (${String(e).split('\n')[0]})`); await page.reload(); await page.waitForTimeout(800); continue }
      const m = await measure(page)
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/${w}x${h}-${name}.png` })
      const ok = m.html <= m.ih && m.body <= m.ih && m.moved === 0
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${w}x${h} ${name}  html=${m.html} body=${m.body} inner=${m.ih} moved=${m.moved} ${m.culprit}`)
      if (!ok) failed = true
      await page.reload(); await page.waitForTimeout(800)
    }
    if (errors.length) console.log('WARN  page errors (not a scroll failure)', errors[0])
    await ctx.close()
  }
} catch (e) { console.log('ERROR', e); failed = true } finally { await browser.close() }
process.exit(failed ? 1 : 0)
