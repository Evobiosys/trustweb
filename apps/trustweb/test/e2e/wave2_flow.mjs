/**
 * Wave 2 (2026-10-07) in the real app, local only:
 *   1. P9: the Feed is off by default (the old bar); querying ("Call into your
 *      web") is one tap from Web, in both query styles, and from Inventory.
 *   4. P22, P26: an inventory item's sheet offers all three tiers and "Only me";
 *      the pill cycles through the same four.
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

/** Item 4: who can ask about an inventory item: acquaintances, friends, close friends, only me. */
async function partAudience(a) {
  await tab(a, 'Inventory')
  await a.getByPlaceholder(/Motorbike/).fill('Spare room in Vienna for visitors')
  await a.getByRole('button', { name: 'Add', exact: true }).click()
  const row = a.locator('.inv', { hasText: 'Spare room in Vienna for visitors' })
  await row.locator('.inv-text').click()
  const choices = await a.locator('.sheet.on [data-item-audience]').evaluateAll((bs) => bs.map((b) => b.querySelector('b').textContent))
  ok('the item sheet offers all three tiers and "Only me"', JSON.stringify(choices) === JSON.stringify(['Acquaintances', 'Friends', 'Close friends', 'Only me']), JSON.stringify(choices))
  await a.locator('.sheet.on [data-item-audience="close"]').click()
  const item = () => a.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).inventory.find((i) => i.text === 'Spare room in Vienna for visitors'))
  ok('choosing "Close friends" is kept, and the sheet says so', (await item()).audience === 'close' && (await a.locator('.sheet.on [data-item-audience="close"]').getAttribute('aria-pressed')) === 'true'
    && /Who can ask: Close friends/.test(await a.locator('.sheet.on').innerText()))
  await shot(a, 'w2-05-item-audience')
  await closeSheet(a)
  const seen = []
  for (let i = 0; i < 4; i++) { seen.push((await row.locator('.aud').innerText()).trim()); await row.locator('.aud').click() }
  ok('the pill cycles through the same four', JSON.stringify(seen) === JSON.stringify(['Close friends', 'Only me', 'Acquaintances', 'Friends']), JSON.stringify(seen))
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
    await partAudience(a)
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
