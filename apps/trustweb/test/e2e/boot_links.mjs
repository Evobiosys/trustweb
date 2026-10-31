// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 review fix 1: the pairing links must survive the startup URL clean. PORT=5461 EXE=<chromium> PW=<playwright-core index.mjs> node boot_links.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const BASE = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const TOKEN = 'abcdefghijklmnopqrstuvwx'
try {
  const open = async (suffix, before) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(BASE); await page.waitForTimeout(1200)
    if (before) await page.evaluate(before)
    await page.goto('about:blank'); await page.goto(BASE + suffix); await page.waitForTimeout(1200)
    return { page, errors }
  }
  const read = (page, key) => page.evaluate((k) => localStorage.getItem(k), key)

  let t = await open(`#signal-link=8123.${TOKEN}`)
  check('signal-link: pairing stored', (await read(t.page, 'trustweb.signal-link')) === JSON.stringify({ port: 8123, token: TOKEN }))
  check('signal-link: hash dropped from the address bar', !(await t.page.evaluate(() => location.hash)))
  check('signal-link: no page errors', t.errors.length === 0)

  t = await open(`#geb-bridge=8124.${TOKEN}`)
  check('geb-bridge: pairing stored', (await read(t.page, 'tw.geb.bridge')) === JSON.stringify({ port: 8124, token: TOKEN }))
  check('geb-bridge: no page errors', t.errors.length === 0)

  t = await open('?loginToken=syt_abc', () => localStorage.setItem('trustweb.matrix.sso-hs', 'https://matrix.invalid'))
  check('matrix: SSO return consumed (pending server cleared)', (await read(t.page, 'trustweb.matrix.sso-hs')) === null)
  check('matrix: loginToken gone from the address bar', !(await t.page.evaluate(() => location.search.includes('loginToken'))))
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
