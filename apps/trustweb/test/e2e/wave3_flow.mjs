/**
 * Wave 3 (2026-10-07) in the real app, local only:
 *   1. Settings > Advanced "Ask only my direct contacts": off by default, kept
 *      in the record only while on, said in the query dock; an ask with it on
 *      still reaches a direct contact (whose build reads the new `direct` flag)
 *      and is answered.
 * Ports: Vite 5283, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/wave3_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const openSettings = async (page) => {
  await tab(page, 'Inventory')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 5_000 })
  // The sheet redraws once the server's status is in (app-wave2 A2): wait for it, so no click lands on the old sheet.
  await page.locator('.sheet.on [data-server-transcribe]').waitFor({ timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(150)
}

/** Ben connects to Jakob with Jakob's code and notes a cargo bike anyone in his web may ask about. */
async function connectBen(browser, a) {
  await tab(a, 'Web')
  await a.locator('.hdr [aria-label^="Show my code"]').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await a.getAttribute('.qrwrap', 'data-payload')
  const b = await newPhone(browser, errors)
  await b.goto(url)
  await b.getByLabel('Your first name').fill('Ben')
  await b.getByRole('button', { name: 'Connect', exact: true }).click()
  await until(async () => (await record(a)).peers.length === 1)
  await a.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await tab(b, 'Inventory')
  await b.getByPlaceholder(/Motorbike/).fill('Cargo bike, can lend it on weekends')
  await b.getByRole('button', { name: 'Add', exact: true }).click()
  return b
}

/** Item 1: the setting, its copy, and an ask with it on. */
async function partDirect(browser, a) {
  await openSettings(a)
  const toggle = a.locator('.sheet.on [data-direct-only]')
  await toggle.scrollIntoViewIfNeeded()
  ok('Settings > Advanced: "Ask only my direct contacts", off by default', (await toggle.getAttribute('aria-pressed')) === 'false' && /Ask only my direct contacts/.test(await toggle.innerText()))
  ok('its hint says what it does', /never passes your ask on/.test(await toggle.innerText()))
  ok('off is not stored (the record keeps only what differs)', !('askDirectOnly' in (await record(a))))
  await toggle.click()
  await a.locator('.sheet.on [data-direct-only][aria-pressed="true"]').waitFor({ timeout: 5_000 })
  ok('on: kept in the record as true', (await record(a)).askDirectOnly === true)
  await a.locator('.sheet.on [data-direct-only]').scrollIntoViewIfNeeded()
  await shot(a, 'w3-01-direct-only-setting')
  await closeSheet(a)

  const b = await connectBen(browser, a)
  await tab(a, 'Web')
  await a.locator('[data-open-query="1"]').click()
  ok('the query dock says only direct contacts are asked', /Only your direct contacts are asked/.test(await a.locator('.query-dock [data-direct-note]').innerText()))
  await a.locator('.query-dock textarea').fill('Does anyone have a cargo bike?')
  await a.getByRole('button', { name: 'Ask my web' }).click()
  const share = b.getByRole('button', { name: 'Share these' })
  await share.waitFor({ timeout: 30_000 }).catch(() => {})
  ok('the direct ask reaches Ben and his phone shows it (the new build reads the flag)', await share.isVisible())
  await shot(a, 'w3-02-direct-only-asked')
  await share.click()
  const got = await until(async () => /Ben chose to share/.test(await a.locator('.query-dock').innerText()), 60_000)
  ok('Ben shares: Jakob gets the answer as before', Boolean(got))
  ok('the dock still says only direct contacts were asked', await a.locator('.query-dock [data-direct-note]').count() === 1)
  await a.locator('.query-dock .x').click()
  await b.context().close()

  await openSettings(a)
  await a.locator('.sheet.on [data-direct-only]').scrollIntoViewIfNeeded()
  await a.locator('.sheet.on [data-direct-only]').click()
  await a.locator('.sheet.on [data-direct-only][aria-pressed="false"]').waitFor({ timeout: 5_000 })
  ok('off again: the field is gone from the record', !('askDirectOnly' in (await record(a))))
  await closeSheet(a)
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(5283, { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    const a = await newPhone(browser, errors)
    await startPhone(a, vite.base, 'Jakob')
    await partDirect(browser, a)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nwave3-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
