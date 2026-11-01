// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 review fix 19: Escape / outside-tap close the chat caret menu and the eye dropdown. PORT=5461 EXE=<chromium> PW=<playwright-core index.mjs> node a11y_keys.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Kaja', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, peerId: 'x1', links: { signal: 'https://signal.me/#p/+436601234567' } }] })
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)

  await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
  check('eye: dropdown opens', (await page.locator('[data-view-drop]').count()) === 1)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  check('eye: Escape closes it', (await page.locator('[data-view-drop]').count()) === 0)
  await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
  await page.mouse.click(5, 450); await page.waitForTimeout(200)
  check('eye: a tap outside closes it', (await page.locator('[data-view-drop]').count()) === 0)

  await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
  await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
  const caret = page.locator('[data-chat-caret="p2"]')
  await caret.click()
  check('caret: menu opens', await page.locator('[data-chat-menu="p2"]').isVisible())
  await page.keyboard.press('Escape')
  check('caret: Escape closes it', !(await page.locator('[data-chat-menu="p2"]').isVisible()) && (await caret.getAttribute('aria-expanded')) === 'false')
  await caret.click(); await page.mouse.click(5, 450)
  check('caret: a tap outside closes it', !(await page.locator('[data-chat-menu="p2"]').isVisible()))
  check('no page errors', errors.length === 0)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
