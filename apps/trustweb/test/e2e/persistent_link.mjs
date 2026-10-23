/**
 * Persistent connect link (wave 20): next to "Show the long link" a toggle "expires in 24 h" (default) / "never expires". Off = the long link
 * carries no nonce and no ts. Headless phone, stock data. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=5298 TW_CHROMIUM_EXE=<headless shell> ../../node_modules/.bin/tsx ../trustweb/test/e2e/persistent_link.mjs
 */
import path from 'node:path'
import { launch, startApp, startPhone, tally } from '../helpers/e2e_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5298)
const t = tally()
const app = await startApp(PORT)
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] })).newPage()
  await startPhone(page, app.base, 'Ada Lovelace')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const toggle = page.locator('[data-act="expiry"]'), long = page.locator('[data-link="long"]')
  const shot = (n) => process.env.TW_SHOTS ? page.screenshot({ path: path.join(process.env.TW_SHOTS, n) }) : null
  const stamped = (u) => /[?&]nonce=[\w-]{16,}/.test(u) && /[?&]ts=\d{13}/.test(u)
  const qr = () => page.getAttribute('.qrwrap', 'data-payload')
  t.ok('the toggle sits next to "Show the long link", reads "expires in 24 h", underlined', (await toggle.innerText()) === 'expires in 24 h' && await toggle.evaluate((b) => getComputedStyle(b).textDecorationLine === 'underline') && await page.locator('[data-act="long"] + [data-act="expiry"]').count() === 1)
  await page.locator('[data-act="long"]').click()
  t.ok('default: the long link carries nonce and ts, so does the QR', stamped(await long.innerText()) && stamped(await qr()))
  await shot('1-expires.png')
  await toggle.click()
  const off = await long.innerText()
  t.ok('never expires: the toggle says so, aria-pressed false', (await toggle.innerText()) === 'never expires' && (await toggle.getAttribute('aria-pressed')) === 'false')
  t.ok('never expires: long link, QR and Copy carry no nonce and no ts', !/[?&](nonce|ts)=/.test(off) && !/[?&](nonce|ts)=/.test(await qr()) && off.startsWith('http'))
  await page.locator('[data-act="copy-long"]').click()
  t.ok('Copy the long link copies the unstamped link', (await page.evaluate(() => navigator.clipboard.readText())) === off)
  await shot('2-never-expires.png')
  await toggle.click()
  t.ok('back on: stamped again', (await toggle.innerText()) === 'expires in 24 h' && stamped(await long.innerText()))
} finally { await browser.close(); await app.stop() }
process.exit(t.failures ? 1 : 0)
