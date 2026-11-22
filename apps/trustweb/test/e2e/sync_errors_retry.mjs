// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 sync-errors-retry: two paired devices (laptop 1280x900, phone 360x780), a real RelayServer behind the Vite /relay proxy, stock data only.
 *   1. Phone offline (airplane mode): Sync now shows "Turn off airplane mode / check Wi-Fi" with a Retry button; the record's syncStatus.error = airplane.
 *   2. Back online, the relay refused (503): "The relay is down, retry in a minute"; Retry with the relay back works and the error line is gone.
 *   3. Relay 401: "Pair again". 4. Other device closed: its own line (not on) with Retry. 5. The error row fits 360x780 (no overlap, no document scroll).
 * Run from apps/demo (PORT 5484):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5484 ../../node_modules/.bin/tsx ../trustweb/test/e2e/sync_errors_retry.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5484)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 45_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-errors-${name}.png`) }) }
const overlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
let taps = { laptop: 0, phone: 0 }
const tap = async (who, loc) => { taps[who]++; await loc.click() }

/** A first-visit sheet ("Not now") may sit over the app after a reload. */
const dismiss = (page) => page.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 2500 }).catch(() => {})

async function openDevices(page, who) {
  await dismiss(page)
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.devices', '1'))
  await tap(who, page.locator('.hdr [aria-label="Settings"]'))
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
  await tap(who, page.locator('[data-open-devices]'))
  await page.getByRole('heading', { name: 'My devices' }).waitFor({ timeout: 10_000 })
}

async function main() {
  const relay = await startRelay({ port: PORT })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('sync-errors-retry against ' + vite.base)
  const browser = await launch()
  try {
    const laptop = await newPhone(browser, errors, { viewport: { width: 1280, height: 900 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    for (const p of [laptop, phone]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(laptop, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await laptop.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Laptop'))
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))
    await openDevices(laptop, 'laptop')
    await tap('laptop', laptop.locator('[data-link-device]'))
    const code = (await laptop.locator('[data-device-code]').innerText()).trim()
    await phone.goto('about:blank')
    await phone.goto(`${vite.base}#pair=${code}`)
    await phone.locator('[data-pair-confirm]').waitFor({ timeout: 25_000 })
    await tap('phone', phone.locator('[data-pair-confirm]'))
    await until(() => laptop.locator('[data-pair-confirm]').isVisible())
    await tap('laptop', laptop.locator('[data-pair-confirm]'))
    await until(async () => (await record(phone)).syncStatus?.lastAt > 0, 60_000)
    await phone.reload(); await phone.waitForTimeout(1500)
    await openDevices(phone, 'phone')
    const err = phone.locator('[data-sync-failed]')
    const syncErr = async () => (await record(phone)).syncStatus?.error
    const press = async (sel) => { await phone.locator(sel).first().click() }

    // 1. airplane mode
    await phone.context().setOffline(true)
    await press('[data-sync-now]')
    await err.waitFor({ timeout: 45_000 })
    ok('1. airplane mode: "Turn off airplane mode / check Wi-Fi" and a Retry button', (await err.innerText()).includes('Turn off airplane mode / check Wi-Fi') && (await phone.locator('[data-sync-retry]').count()) === 1, await err.innerText())
    ok('1. the record notes the cause: airplane', (await syncErr()) === 'airplane')
    await shot(phone, 'airplane-360')
    await phone.context().setOffline(false)

    // 2. the relay refuses
    await phone.route('**/relay/**', (r) => r.fulfill({ status: 503, body: 'down' }))
    await press('[data-sync-retry]')
    await until(async () => (await err.innerText()).includes('The relay is down, retry in a minute'), 45_000)
    ok('2. relay 503: "The relay is down, retry in a minute"', (await err.innerText()).includes('The relay is down'), await err.innerText())
    ok('2. cause: relay', (await syncErr()) === 'relay')
    await shot(phone, 'relay-360')
    // 3. auth
    await phone.unroute('**/relay/**')
    await phone.route('**/relay/**', (r) => r.fulfill({ status: 401, body: 'no' }))
    await press('[data-sync-retry]')
    await until(async () => (await err.innerText()).includes('Pair again'), 45_000)
    ok('3. relay 401: "Pair again"', (await err.innerText()).includes('Pair again'), await err.innerText())
    ok('3. cause: auth', (await syncErr()) === 'auth')
    // 5. layout
    const box = await phone.evaluate(() => { const e = document.querySelector('[data-sync-failed]'); const b = e.getBoundingClientRect(); const r = e.querySelector('button').getBoundingClientRect(); return { inside: r.right <= b.right + 1 && r.left >= b.left - 1, doc: document.documentElement.scrollWidth <= innerWidth } })
    ok('5. the Retry button sits inside the error row and the page does not scroll sideways', box.inside && box.doc, JSON.stringify(box))
    await phone.unroute('**/relay/**')
    // recovery: Retry works, the line goes
    await press('[data-sync-retry]')
    await until(async () => (await err.count()) === 0, 60_000)
    ok('2. relay back: Retry clears the error line and the record\'s cause', (await err.count()) === 0 && (await syncErr()) === undefined, `${await err.allInnerTexts()} / ${await syncErr()}`)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(`\n${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
