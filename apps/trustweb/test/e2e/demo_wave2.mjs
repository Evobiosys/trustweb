/**
 * Wave 2 (2026-10-07) on the side-by-side demo page (app/demo/), local only:
 *   3. P12, P13: coming back to the demo shows it as it was left: the first
 *      phone's people and things, and every device that was open; the one
 *      [Install] button reads "Make it your personal account" and carries the
 *      notes, people and things over (nobody types them again); "Start over"
 *      forgets it all.
 * Ports: Vite 5282, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/demo_wave2.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

const device = (page, n) => page.frameLocator(`iframe[title="Device ${n}"]`)
const holderRecord = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.endsWith('.holder'))
  return k ? JSON.parse(localStorage.getItem(k)) : null
})

/** Starts the first phone as Jakob, adds Max to his web and a thing to his inventory. */
async function startHolder(page) {
  const phone = device(page, 1)
  await phone.getByLabel('Your first name').fill('Jakob')
  await phone.getByRole('button', { name: 'Start on this phone' }).click()
  await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const gotIt = phone.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()
  await phone.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
  await phone.getByPlaceholder('Name').first().fill('Max')
  await phone.getByRole('button', { name: 'Add to my web' }).click()
  await phone.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
  await phone.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await phone.getByPlaceholder(/Motorbike/).fill('Ladder, 3 m, to lend')
  await phone.getByRole('button', { name: 'Add', exact: true }).click()
  await phone.locator('.inv-text', { hasText: 'Ladder, 3 m, to lend' }).waitFor({ timeout: 5_000 })
}

/** Item 3: a second visit shows the demo as it was left; Install carries it over; Start over forgets it. */
async function partComeBack(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => void d.accept())
  await page.goto(base + 'demo/')
  await startHolder(page)
  await page.locator('.dock .add').click()
  await device(page, 2).getByRole('button', { name: 'Connect', exact: true }).click({ timeout: 30_000 })
  await device(page, 2).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  ok('first visit: two devices, the second one started', await page.locator('iframe').count() === 2)

  // The second visit: the same browser, the page opened again.
  await page.goto('about:blank')
  await page.goto(base + 'demo/')
  const phone = device(page, 1)
  await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  ok('second visit: the first phone opens on Jakob\'s web, not the start screen', await phone.locator('.node', { hasText: 'Max' }).count() === 1)
  await phone.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  ok('second visit: the thing he noted is still there', await phone.locator('.inv-text', { hasText: 'Ladder, 3 m, to lend' }).count() === 1)
  await device(page, 2).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  ok('second visit: both devices are open again, the second one as it was', await page.locator('iframe').count() === 2)
  await shot(page, 'w2-03-demo-second-visit')

  // The one button: "Make it your personal account", then the live app holds the notes.
  await page.locator('[data-demo-install]').click()
  await page.getByRole('dialog', { name: 'Make it your personal account' }).waitFor({ timeout: 5_000 })
  ok('Install reads "Make it your personal account"; nothing is typed again', /Nothing needs to be typed again/.test(await page.locator('.d2l').innerText())
    && (await page.locator('[data-demo-install]').getAttribute('title')) === 'Make it your personal account, then install TrustWeb')
  await shot(page, 'w2-04-make-it-personal')
  await page.locator('[data-d2l="clean"]').click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const live = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  ok('the personal account has Jakob, Max and the ladder: carried over, not retyped', live?.me?.displayName === 'Jakob'
    && live.people.some((p) => p.name === 'Max') && live.inventory.some((i) => i.text === 'Ladder, 3 m, to lend'), JSON.stringify({ people: live?.people?.map((p) => p.name), inv: live?.inventory?.map((i) => i.text) }))
  ok('the demo itself is kept (it can be opened again)', (await holderRecord(page))?.me?.displayName === 'Jakob')

  // Start over forgets the demo: one device, the start screen.
  await page.goto(base + 'demo/')
  await device(page, 1).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('.restart').click()
  await page.waitForLoadState('load')
  await device(page, 1).getByLabel('Your first name').waitFor({ timeout: 15_000 })
  ok('"Start over": one device, the start screen, the demo forgotten', await page.locator('iframe').count() === 1 && (await holderRecord(page)) === null)
  await ctx.close()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(5282, { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    await partComeBack(browser, vite.base)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\ndemo-wave2: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
