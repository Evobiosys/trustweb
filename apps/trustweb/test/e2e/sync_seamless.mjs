// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c sync-seamless (A1, A2, A5): a laptop (1280x900) and a phone (360x780), a real RelayServer behind the Vite /relay proxy, stock data only.
 *   1. Laptop: Settings > My devices > Link a device shows the QR and a link of the app (https://app.trustweb.one/#pair=...): taps counted.
 *   2. Phone: the camera app opens that link (a full page load of the fragment): the confirm sheet is there with no tap, the address bar is cleared;
 *      Confirm on both. Taps after the camera: 1 on the phone, 4 on the laptop (target <= 5 on the joining side's own part).
 *   3. A person on the laptop reaches the phone by itself; the laptop's status shows no unacknowledged send afterwards (ack).
 *   4. Held items from a newer build: the banner "Update the app to see 3 newer items" with an Update button sits clear of every other control at both sizes;
 *      Update reloads the page.
 * Run from apps/demo (PORT 5477):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5477 ../../node_modules/.bin/tsx ../trustweb/test/e2e/sync_seamless.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5477)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 45_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-seamless-${name}.png`) }) }
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
  console.log('sync-seamless against ' + vite.base)
  const browser = await launch()
  try {
    const laptop = await newPhone(browser, errors, { viewport: { width: 1280, height: 900 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    for (const p of [laptop, phone]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(laptop, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await laptop.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Laptop'))
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))
    // a person on the laptop, to see it travel
    await laptop.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.people.push({ id: 'probe-anna', name: 'Probe Anna', context: '', ring: 'friend', metAt: 1, lines: [] }); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await laptop.reload(); await laptop.waitForTimeout(1500)

    // 1. the link
    await openDevices(laptop, 'laptop')
    await tap('laptop', laptop.locator('[data-link-device]'))
    const link = await laptop.locator('[data-device-code]').getAttribute('data-pair-link')
    const code = (await laptop.locator('[data-device-code]').innerText()).trim()
    ok('1. the QR holds a link of the app with the pairing code as its fragment', link === `https://app.trustweb.one/#pair=${code}` && code.startsWith('TWD1~'), String(link).slice(0, 60))
    await shot(laptop, 'link-1280')

    // 2. the phone's camera app opens the link: a full page load, no tap in the app before the confirm sheet
    await phone.goto('about:blank')
    await phone.goto(`${vite.base}#pair=${code}`)
    await phone.locator('[data-pair-confirm]').waitFor({ timeout: 25_000 })
    ok('2. the confirm sheet is there after zero taps in the app', true)
    // review-44c R1: a link can come from anyone, so the phone sends nothing before its Confirm (the laptop's sheet follows it) and says what Confirm hands over
    ok('2. the phone says that the link must come from a device of mine', await phone.locator('[data-pair-link-warn]').isVisible())
    ok('2. nothing reached the laptop before the phone confirmed', !(await laptop.locator('[data-pair-confirm]').isVisible()))
    const phoneFp = await phone.locator('[data-fingerprint]').innerText()
    ok('2. the pair code is gone from the address bar', (await phone.evaluate(() => location.hash)) === '')
    await shot(phone, 'confirm-360')
    await tap('phone', phone.locator('[data-pair-confirm]'))
    await until(() => laptop.locator('[data-pair-confirm]').isVisible())
    ok('2. both devices show the same 4 characters', phoneFp === (await laptop.locator('[data-fingerprint]').innerText()))
    await tap('laptop', laptop.locator('[data-pair-confirm]'))
    ok('2. both list the other device', (await phone.locator('[data-device]').count()) === 1 && (await laptop.locator('[data-device]').count()) === 1)
    console.log(`  measured taps: showing device ${taps.laptop}, joining device ${taps.phone}, total ${taps.laptop + taps.phone} (before: 4 + 6 = 10)`)
    ok(`2. pairing takes at most 5 taps in total: ${taps.laptop + taps.phone}`, taps.laptop + taps.phone <= 5)

    // 3. the person arrives by itself; the ack closes the send
    const got = await until(async () => (await record(phone)).people.some((p) => p.id === 'probe-anna'), 60_000)
    ok('3. the laptop\'s person reaches the phone without any tap', !!got)
    const acked = await until(async () => { const s = (await record(laptop)).syncStatus; return s && s.devices === 1 && s.unacked === 0 && s.lastAt > 0 }, 45_000)
    ok('3. the laptop\'s status shows the send acknowledged (unacked 0)', !!acked, JSON.stringify((await record(laptop)).syncStatus))

    // 4. held items: the banner, clear of every control, Update reloads
    for (const [name, page, who] of [['360x780', phone, 'phone'], ['1280x900', laptop, 'laptop']]) {
      await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => /^trustweb\.sync\.v1\./.test(k) && !k.endsWith('.held'))
        const store = JSON.parse(localStorage.getItem(key))
        const raw = JSON.stringify({ v: 3, schemaVersion: 999, people: [], inventory: [], meetings: [], at: {}, by: {}, events: [], chats: {}, channels: { mine: {}, share: {} } })
        localStorage.setItem(key + '.held', JSON.stringify([{ did: store.pairings[0].did, name: 'Other', at: 1, items: 3, raw }]))
      })
      await page.reload(); await page.waitForTimeout(1800)
      await openDevices(page, who)
      const sheet = page.locator('.sheet.on')
      const banner = sheet.locator('[data-sync-held]').first()
      await banner.waitFor({ timeout: 10_000 })
      ok(`4. ${name}: the banner says "Update the app to see 3 newer items" with an Update button`, (await banner.innerText()).includes('Update the app to see 3 newer items') && (await sheet.locator('[data-sync-held-update]').count()) >= 1, await banner.innerText())
      // one evaluate: the sheet scrolls, so the rectangles must come from the same instant
      const rects = await page.evaluate(() => {
        const sh = document.querySelector('.sheet.on')
        const r = (sel) => { const b = sh.querySelector(sel)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null }
        return { box: r('[data-sync-held]'), others: ['[data-sync-auto]', '[data-link-device]', '[data-enter-code]', '[data-sync-status-line]'].map((sel) => [sel, r(sel)]).filter(([, b]) => b) }
      })
      ok(`4. ${name}: the banner overlaps no other control`, !!rects.box && rects.others.length === 4 && rects.others.every(([, b]) => !overlap(rects.box, b)), JSON.stringify(rects))
      await shot(page, `held-${name}`)
      await page.evaluate(() => { window.__before = 1 })
      await sheet.locator('[data-sync-held-update]').first().click()
      // review-44c R5: the banner runs the app's one Update logic: a newer version reloads, none says so (a bare reload would bring the same build back)
      const LATEST = 'No newer version is published yet'
      await page.waitForFunction((t) => window.__before === undefined || document.body.innerText.includes(t), LATEST, { timeout: 15_000 }).catch(() => {})
      ok(`4. ${name}: Update reloads into a newer version, or says none is published yet`, await page.evaluate((t) => window.__before === undefined || document.body.innerText.includes(t), LATEST))
      await page.waitForTimeout(1200)
    }
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
