// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c item 4, the Signal-like pairing (today's direction: sync_seamless.mjs). A laptop in use (1280x900) and a NEW phone (360x780,
 * still on the welcome screen), a real RelayServer behind the Vite /relay proxy, stock data only.
 *   1. Phone, welcome screen: "Show a code for my other device" shows the QR + code (1 tap), the lead says to scan it from My devices.
 *   2. Laptop: Settings > My devices > Scan a new device opens the scanner sheet; the code is read (headless: pasted, as the camera would hand it).
 *   3. Both show the same 4 characters, Confirm on both; taps counted per device.
 *   4. The laptop's person reaches the new phone by itself. No overlap of the new buttons at either size.
 * Run: PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5481 node answers_44c_pair.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5481)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 45_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `answers-44c-pair-${name}.png`) }) }
const overlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
const taps = { laptop: 0, phone: 0 }
const tap = async (who, loc) => { taps[who]++; await loc.click() }
const dismiss = (page) => page.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 2500 }).catch(() => {})
const noOverlap = (page, sels) => page.evaluate((sels) => {
  const sh = document.querySelector('.sheet.on') ?? document
  const bs = sels.map((s) => sh.querySelector(s)?.getBoundingClientRect()).filter(Boolean).map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }))
  return { n: bs.length, bs }
}, sels)

async function main() {
  const relay = await startRelay({ port: PORT })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('answers-44c pair against ' + vite.base)
  const browser = await launch()
  try {
    const laptop = await newPhone(browser, errors, { viewport: { width: 1280, height: 900 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    for (const p of [laptop, phone]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(laptop, vite.base, 'Jakob')
    await laptop.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Laptop'))
    await laptop.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.people.push({ id: 'probe-anna', name: 'Probe Anna', context: '', ring: 'friend', metAt: 1, lines: [] }); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await laptop.reload(); await laptop.waitForTimeout(1500)

    // 1. the new phone, still on the welcome screen
    await phone.goto(vite.base); await phone.waitForLoadState('networkidle').catch(() => {}); await phone.waitForTimeout(1500)
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))
    const show = phone.locator('[data-show-new-code]').first()
    ok('1. the welcome screen offers "Show a code for my other device"', (await show.count()) === 1 && (await show.innerText()).includes('Show a code for my other device'))
    const start = await noOverlap(phone, ['[data-link-from-start]', '[data-show-new-code]', '.start-form .btn-electric'])
    ok('1. 360: the new button overlaps nothing on the welcome screen', start.n === 3 && start.bs.every((a, i) => start.bs.every((b, j) => i === j || !overlap(a, b))), JSON.stringify(start.bs))
    await tap('phone', show)
    await phone.locator('[data-device-code]').waitFor({ timeout: 15_000 })
    const code = (await phone.locator('[data-device-code]').innerText()).trim()
    ok('1. the phone shows its own code (QR + text) and says to scan it from the device in use', code.startsWith('TWD1~') && (await phone.locator('[data-pair-new-lead]').innerText()).includes('Scan a new device') && (await phone.locator('.qr-box').count()) === 1)
    await shot(phone, 'new-360')

    // 2. the laptop scans it
    await dismiss(laptop)
    await laptop.locator('nav.tabs button', { hasText: 'Web' }).click()
    await laptop.evaluate(() => localStorage.setItem('trustweb.ui.settings.devices', '1'))
    await tap('laptop', laptop.locator('.hdr [aria-label="Settings"]'))
    await laptop.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
    await tap('laptop', laptop.locator('[data-open-devices]'))
    await laptop.getByRole('heading', { name: 'My devices' }).waitFor({ timeout: 10_000 })
    const mine = await noOverlap(laptop, ['[data-link-device]', '[data-scan-new-device]', '[data-show-new-code]', '[data-enter-code]'])
    ok('2. 1280: My devices has Scan a new device beside Link another device, no overlap', mine.n === 4 && mine.bs.every((a, i) => mine.bs.every((b, j) => i === j || !overlap(a, b))), JSON.stringify(mine.bs))
    await tap('laptop', laptop.locator('[data-scan-new-device]'))
    await laptop.getByRole('heading', { name: 'Scan a new device' }).waitFor({ timeout: 10_000 })
    ok('2. the scanner sheet opens with the camera started (video shown)', !(await laptop.locator('.scan-video').evaluate((v) => v.hidden)))
    await shot(laptop, 'scan-1280')
    // headless has no QR in front of a camera: the decoded text goes into the same join path (paste + OK counts as the scan, 1 tap)
    await laptop.locator('[data-code-input]').fill(code)
    await tap('laptop', laptop.locator('[data-code-ok]'))

    // 3. confirm on both
    await laptop.locator('[data-pair-confirm]').waitFor({ timeout: 25_000 })
    await until(() => phone.locator('[data-pair-confirm]').isVisible())
    ok('3. both devices show the same 4 characters', (await phone.locator('[data-fingerprint]').innerText()) === (await laptop.locator('[data-fingerprint]').innerText()))
    await tap('laptop', laptop.locator('[data-pair-confirm]'))
    await tap('phone', phone.locator('[data-pair-confirm]'))
    ok('3. both list the other device', (await phone.locator('[data-device]').count()) === 1 && (await laptop.locator('[data-device]').count()) === 1)
    console.log(`  measured taps (Signal-like): new device ${taps.phone}, device in use ${taps.laptop}, total ${taps.phone + taps.laptop}`)
    ok(`3. the new device needs 2 taps (show, confirm): ${taps.phone}`, taps.phone === 2)
    ok(`3. the device in use needs at most 5 taps (settings, my devices, scan, read, confirm): ${taps.laptop}`, taps.laptop <= 5)

    // 4. the laptop's record reaches the new phone
    const got = await until(async () => ((await record(phone))?.people ?? []).some((p) => p.id === 'probe-anna'), 60_000)
    ok('4. the laptop\'s person reaches the new phone', !!got)
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
