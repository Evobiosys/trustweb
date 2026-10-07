/**
 * Wave 2 (2026-10-07) in the real app, local only:
 *   1. P9: the Feed is off by default (the old bar); querying ("Call into your
 *      web") is one tap from Web, in both query styles, and from Inventory.
 * Ports: Vite 5281, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/wave2_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    // The start screen's name field leaves the phone frame scrolled in headless Chromium: show the frame from its top.
    await page.evaluate(() => { window.scrollTo(0, 0); const p = document.querySelector('.phone'); if (p) p.scrollTop = 0 })
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const tabLabels = (page) => page.locator('nav.tabs > button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()))
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const dockOpen = async (page) => (await page.locator('.query-dock').count()) === 1 && await page.locator('.query-dock').isVisible()

/** Item 1: Feed off, the query one tap away from Web and Inventory. */
async function partQuery(a) {
  ok('the bar is the old one by default: Web | Record | Inventory', JSON.stringify(await tabLabels(a)) === JSON.stringify(['Web', 'Record', 'Inventory']), JSON.stringify(await tabLabels(a)))
  await a.locator('[data-open-query="1"]').click()
  ok('Web: one tap on "Call into your web" opens the query', await dockOpen(a))
  await a.locator('.query-dock .x').click()

  await tab(a, 'Inventory')
  const call = a.locator('[data-open-query="inventory"]')
  ok('Inventory: "Call into your web" is there', await call.isVisible() && (await call.getAttribute('aria-label')) === 'Call into your web')
  const [cb, rb] = [await call.boundingBox(), await a.locator('.requests-fab').boundingBox()]
  ok('it sits opposite "Review requests", never over it', Boolean(cb && rb) && cb.x + cb.width <= rb.x, JSON.stringify({ cb, rb }))
  await shot(a, 'w2-01-inventory-call')
  await call.click()
  ok('Inventory: one tap lands on Web with the query open', await dockOpen(a) && await a.getByRole('heading', { name: 'Your TrustWeb' }).isVisible())
  await shot(a, 'w2-02-query-from-inventory')
  await a.locator('.query-dock .x').click()

  // The other query style (Settings: the magnifier means querying): still one tap.
  await tab(a, 'Inventory')
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('.sheet.on .radio', { has: a.locator('b', { hasText: /^Query$/ }) }).click()
  await closeSheet(a)
  await tab(a, 'Web')
  await a.locator('[data-open-query="1"]').click()
  ok('query style "search": one tap still opens the query', await dockOpen(a))
  await a.locator('.query-dock .x').click()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(5281, { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    const a = await newPhone(browser, errors)
    await startPhone(a, vite.base, 'Jakob')
    await partQuery(a)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nwave2-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
