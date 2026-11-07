// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 small-ui proof (headless, dev only): PORT=5431 EXE=<chromium> PW=<playwright-core index.mjs> node small_ui.mjs.
 *  Header: search, eye and settings stay on screen at 320/360/1280 px with 3 pins on, on Web and Meet, no sideways scroll.
 *  Card: the connected icons are drawn once; the TrustWeb icon opens the chat; a link-only messenger stays as a dashed icon. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5431}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  uiPins: { views: [], header: ['dnd', 'advanced', 'qr-only'] },
  people: [
    { id: 'p1', name: 'Ana Anders', ring: 'close', lines: [], context: '', metAt: Date.now(), peerId: 'x1', channels: { signal: '+436601234568' } },
    { id: 'p2', name: 'Ben Beispiel', ring: 'friend', lines: [], context: '', metAt: Date.now(), links: { signal: 'https://signal.me/#p/+436601234567' } },
  ] })
const setup = async (width) => {
  const page = await (await browser.newContext({ viewport: { width, height: 740 } })).newPage()
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(800)
  return page
}
const inView = (page, sel, w) => page.locator(sel).first().evaluate((e, width) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= width }, w).catch(() => false)
try {
  for (const w of [320, 360, 1280]) {
    const page = await setup(w)
    for (const screen of ['web', 'meet']) {
      if (screen === 'meet') await page.locator('.status-pill').first().click(); else await page.locator('[data-go="web"]').first().click()
      await page.waitForTimeout(500)
      check(`${w}px ${screen}: settings gear in view`, await inView(page, '.hdr [data-settings-gear]', w))
      if (screen === 'web') {
        check(`${w}px web: search in view`, await inView(page, '.hdr .web-search-btn', w))
        check(`${w}px web: eye in view`, await inView(page, '.hdr .hdr-right button:nth-child(2)', w))
      }
      check(`${w}px ${screen}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth))
    }
    if (w === 360) {
      await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
      await page.evaluate(() => { document.querySelector('[data-pid="p1"]')?.click() }); await page.waitForTimeout(600)
      check('card: connected icons drawn once, no second row', (await page.locator('[data-small-card] [data-connected-on]').count()) === 1 && (await page.locator('[data-msg-glyphs]').count()) === 0)
      await page.locator('[data-connected-place="trustweb"]').first().click(); await page.waitForTimeout(500)
      check('card: tap on the TrustWeb icon opens the chat sheet', await page.locator('.sheet.on').count() === 1)
      await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.sheet.on')?.dispatchEvent(new Event('click'))); await page.waitForTimeout(300)
    }
    await page.close()
  }
  const page = await setup(360)
  await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(400)
  await page.evaluate(() => { document.querySelector('[data-pid="p2"]')?.click() }); await page.waitForTimeout(600)
  check('card: a link-only messenger stays as one dashed icon', (await page.locator('[data-connected-place="link:signal"].linked').count()) === 1)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
