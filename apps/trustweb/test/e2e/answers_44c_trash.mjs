// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c item 5 (A4 tombstones): a laptop (1280x900) and a phone (360x780) paired over a real RelayServer, stock data only.
 *   1. A resource made on the laptop reaches the phone (Auto sync).
 *   2. Deleted on the laptop (Resources, ×): it leaves the phone too, and sits in the phone's Settings > Recently deleted with "30 days left".
 *   3. Restore on the phone: it is back on the phone and, by Auto sync, on the laptop; both trash lists are empty.
 * Run: PLAYWRIGHT_PACKAGE=<playwright-core> CHROMIUM_PATH=<chrome-headless-shell> TW_PORT=5481 tsx answers_44c_trash.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5481)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 60_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 300)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `answers-44c-trash-${name}.png`) }) }
const dismiss = (page) => page.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 2500 }).catch(() => {})
const ITEM = { id: 'probe-ladder', text: 'Probe ladder', tags: [], audience: 'trusted', included: true, createdAt: 1 }
const has = async (page, where) => ((await record(page))?.[where] ?? [])

async function openSettings(page) {
  await dismiss(page)
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.trash', '1'))
  await page.locator('.hdr [aria-label="Settings"]').first().click()
  await page.locator('[data-settings-section="trash"]').waitFor({ state: 'attached', timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
}

async function main() {
  const relay = await startRelay({ port: PORT })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('answers-44c trash against ' + vite.base)
  const browser = await launch()
  try {
    const laptop = await newPhone(browser, errors, { viewport: { width: 1280, height: 900 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    for (const p of [laptop, phone]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(laptop, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await laptop.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Laptop'))
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))
    await laptop.evaluate((it) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.inventory.push(it); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, ITEM)
    await laptop.reload(); await laptop.waitForTimeout(1500)

    // pair (today's flow): Link a device on the laptop, the phone opens the link
    await dismiss(laptop)
    await laptop.evaluate(() => localStorage.setItem('trustweb.ui.settings.devices', '1'))
    await openSettings(laptop)
    await laptop.locator('[data-open-devices]').click()
    await laptop.locator('[data-link-device]').click()
    const code = (await laptop.locator('[data-device-code]').innerText()).trim()
    await phone.goto("about:blank")
    await phone.goto(`${vite.base}#pair=${code}`)
    await phone.locator('[data-pair-confirm]').waitFor({ timeout: 25_000 })
    await until(() => laptop.locator('[data-pair-confirm]').isVisible())
    await phone.locator('[data-pair-confirm]').click()
    await laptop.locator('[data-pair-confirm]').click()

    // 1. the resource reaches the phone
    ok('1. the laptop\'s resource reaches the phone', !!(await until(async () => (await has(phone, 'inventory')).some((x) => x.id === ITEM.id))))

    // 2. delete on the laptop (Resources, ×)
    await laptop.keyboard.press('Escape').catch(() => {})
    await laptop.evaluate(() => document.querySelector('.sheet.on .x, .sheet.on [data-sheet-home]')?.click())
    await laptop.locator('[data-go="inventory"]').first().click()
    await laptop.locator(`.inv:has([data-item="${ITEM.id}"]) .inv-side .x`).click({ timeout: 10_000 })
    ok('2. gone on the laptop, in its trash', !(await has(laptop, 'inventory')).some((x) => x.id === ITEM.id) && (await has(laptop, 'trash')).some((x) => x.id === ITEM.id))
    const gone = await until(async () => !(await has(phone, 'inventory')).some((x) => x.id === ITEM.id) && (await has(phone, 'trash')).some((x) => x.id === ITEM.id))
    ok('2. the delete reaches the phone: gone there, in its trash', !!gone)
    await phone.reload(); await phone.waitForTimeout(1500)
    await openSettings(phone)
    const row = phone.locator(`[data-trash-row="resource:${ITEM.id}"]`)
    ok('2. the phone\'s Settings > Recently deleted lists it with 30 days left', (await row.count()) === 1 && (await row.innerText()).includes('Probe ladder') && (await row.innerText()).includes('30 days left'))
    const box = await row.boundingBox()
    ok('2. 360: the row fits the screen', !!box && box.x >= 0 && box.x + box.width <= 361, JSON.stringify(box))
    await row.scrollIntoViewIfNeeded()
    await shot(phone, 'recently-deleted-360')

    // 3. restore on the phone
    await phone.locator(`[data-trash-restore="resource:${ITEM.id}"]`).click()
    ok('3. back on the phone, its trash empty', (await has(phone, 'inventory')).some((x) => x.id === ITEM.id) && !(await has(phone, 'trash')).length)
    const back = await until(async () => (await has(laptop, 'inventory')).some((x) => x.id === ITEM.id) && !(await has(laptop, 'trash')).length)
    ok('3. the restore reaches the laptop', !!back)
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
