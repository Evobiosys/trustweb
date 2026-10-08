/**
 * Wave 6 (U4 a), Jakob 2026-10-08 08:23: "make sure the query also returns the content from the demo notes and
 * what others always make visible". What a NEW demo / personal account gets back when it asks:
 *
 *   A. The /demo/ page (side-by-side phones, solo.html): Maya's phone is the person's own, seeded with the imaginary
 *      web (Maya's couch, Jakob's ten public lines as notes on the person "Jakob"); Jonas asks.
 *        "couch"                  -> Maya's prompt holds "Couch when you are in Vienna"; she shares; Jonas sees it
 *        Jakob's ten lines (3)    -> Maya's prompt holds the note line of the person "Jakob"; she shares; Jonas sees it
 *        "Pfanne" (typed in the app, like the afternoon guest did) -> prompt, share, seen
 *      Every one of them is asked of a PERSON: a phone never answers by itself, the yes stays (never auto-answered).
 *   B. A NEW demo account (Carl-demo, made by Jakob's phone with the demo front door published next to the app):
 *      the front door answers three of the ten lines by itself, "Allowed in advance by Jakob" on each, while
 *      Jakob's phone (which holds none of them) stays silent. The door is unclaimed here (no owner phone behind
 *      it), so it answers at one window and the run stays short.
 *
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8970), the demo front door in this process.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/ask_demo_content.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

// ---------------------------------------------------------------------------
// A. the /demo/ page
// ---------------------------------------------------------------------------

/** Jonas asks `text`; Maya's phone must show a prompt holding `expect`; she shares; Jonas's card holds `expect`. */
async function soloAsk(page, maya, jonas, text, expect, label) {
  await jonas.locator('textarea').fill(text)
  await jonas.getByRole('button', { name: 'Call into my web' }).click()
  const prompted = await maya.getByText('Jonas asks').waitFor({ timeout: 25_000 }).then(() => true).catch(() => false)
  const lines = prompted ? await maya.locator('.ask-line').allInnerTexts() : []
  ok(`${label}: Maya is asked and her prompt shows the line`, prompted && lines.some((t) => expect.test(t)), JSON.stringify(lines))
  if (!prompted) return
  await maya.getByRole('button', { name: 'Share these' }).click()
  await jonas.locator('.card.asked .outcome').first().waitFor({ timeout: 90_000 })
  const got = await jonas.locator('.card.asked').first().innerText()
  ok(`${label}: Jonas gets it after the window`, /Maya chose to share/.test(got) && expect.test(got), got)
  await maya.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
}

async function sectionDemoPage(browser, base) {
  console.log('A. the /demo/ page (Maya = the person\'s own phone, Jonas asks)')
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  await page.goto(base + 'solo.html')
  const maya = page.frameLocator('iframe[title="Device 1"]')
  const jonas = page.frameLocator('iframe[title="Device 2"]')
  await maya.getByLabel('Your first name').fill('Maya')
  await maya.getByRole('button', { name: 'Start on this phone' }).click()
  await maya.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  // The person adds a "Pfanne" in the app, as the afternoon guest did (default: shared with acquaintances and up).
  await maya.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await maya.getByPlaceholder(/Motorbike/).fill('Pfanne')
  await maya.getByRole('button', { name: 'Add', exact: true }).click()
  await maya.locator('.inv', { hasText: 'Pfanne' }).waitFor({ timeout: 5_000 })
  await maya.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.getByRole('button', { name: /Add a device/ }).click()
  await jonas.getByRole('button', { name: 'Connect', exact: true }).waitFor({ timeout: 30_000 })
  await jonas.getByRole('button', { name: 'Connect', exact: true }).click()
  await jonas.getByRole('button', { name: 'Call into your web' }).click({ timeout: 30_000 })
  await page.waitForFunction(() => {
    const f = [...document.querySelectorAll('iframe')].find((i) => i.title === 'Device 2')
    const b = [...(f?.contentDocument?.querySelectorAll('button') ?? [])].find((x) => x.textContent === 'Call into my web')
    return b && !b.disabled
  }, null, { timeout: 30_000 })
  await soloAsk(page, maya, jonas, 'Does anyone have a couch I could sleep on?', /Couch when you are in Vienna/, 'couch')
  await soloAsk(page, maya, jonas, 'Which map projection do you use for global maps?', /Equal Earth/, 'Jakob\'s line "Equal Earth"')
  await soloAsk(page, maya, jonas, 'Who could hold a workshop on trustweb?', /workshop on the conceptual building blocks/, 'Jakob\'s line "workshop"')
  await soloAsk(page, maya, jonas, 'Which open-source license do you recommend for SaaS?', /perfect' open-source license/, 'Jakob\'s line "license"')
  await soloAsk(page, maya, jonas, 'Hat jemand eine Pfanne?', /Pfanne/, 'Pfanne')
  await shot(page, 'a-demo-page')
  await ctx.close()
}

// ---------------------------------------------------------------------------
// B. a new demo account and the demo front door
// ---------------------------------------------------------------------------

async function makeDemoAccount(jakob, first) {
  await jakob.getByRole('button', { name: /Show my code/ }).click()
  await jakob.getByRole('tab', { name: 'Demo account' }).waitFor({ timeout: 10_000 })
  await jakob.getByRole('tab', { name: 'Demo account' }).click()
  const field = jakob.getByLabel('Name of the demo account')
  await jakob.waitForTimeout(500)
  await field.focus()
  await jakob.keyboard.type(first)
  await jakob.getByRole('button', { name: 'Make the demo account' }).click()
  await jakob.getByRole('heading', { name: `${first}-demo is ready` }).waitFor({ timeout: 10_000 })
  await jakob.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return jakob.getAttribute('.qrwrap', 'data-payload')
}

async function sectionFrontDoor(browser, scratch, publicDir, relay) {
  console.log('B. a new demo account asks the demo front door')
  const { startPeer, PeerPolicy } = await import('../../../../services/trustweb-peer/peer.ts')
  const peer = await startPeer({
    stateDir: path.join(scratch, 'peer'), inventoryFile: path.join(TW_ROOT, '../../services/trustweb-peer/demo_inventory.json'),
    relayOrigin: `http://127.0.0.1:${relay.port}`, policy: PeerPolicy.Open, healthPort: 0, log: () => {},
  })
  writeFileSync(path.join(publicDir, 'demo-peer.json'), JSON.stringify(peer.card))
  const vite = await startVite(PORT + 1, { relayPort: relay.port, publicDir })
  try {
    const jakob = await newPhone(browser, errors)
    await startPhone(jakob, vite.base, 'Jakob')
    const link = await makeDemoAccount(jakob, 'Carl')
    ok('the code names the demo front door too', /&p=did%3Apeer/.test(link), link)
    const carl = await newPhone(browser, errors)
    await carl.goto(link)
    await carl.getByRole('button', { name: 'Start as Carl-demo' }).click()
    await carl.locator('.query-dock').waitFor({ timeout: 20_000 })
    await carl.locator('.node:not(.you)', { hasText: 'Jakob' }).first().waitFor({ timeout: 20_000 })
    const card = jakob.locator('.demo-friends')
    await card.waitFor({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Allow', exact: true }).click()
    await carl.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
    const asks = [
      ['Is there a workshop on the building blocks of trustweb?', /workshop on the conceptual building blocks/, 'workshop'],
      ['Who can help me tidy up my online presence?', /clean up your online presence/, 'online presence'],
      // two of the ten lines are about the license (the "perfect" one and the AGPL/AMPL one): either answers
      ['Which license would you use for SaaS?', /perfect' open-source license|AGPL by default/, 'license'],
      ['Which map projection do you use for global maps?', /Equal Earth/, 'projection'],
    ]
    for (const [text, expect, label] of asks) {
      if (await carl.locator('.query-dock').count() === 0) await carl.getByRole('button', { name: /Call into your web/ }).first().click()
      await carl.locator('.query-dock textarea').fill(text)
      await carl.getByRole('button', { name: 'Call into my web' }).click()
      await carl.locator('.card.asked .outcome').first().waitFor({ timeout: 90_000 })
      const out = await carl.locator('.card.asked').first().innerText()
      ok(`Carl-demo asks about the ${label}: the front door answers with Jakob's public line`, /Jakob chose to share/.test(out) && expect.test(out), out)
      ok(`  and it reads as allowed in advance (${label})`, /Allowed in advance by Jakob/.test(out), out)
      await carl.getByRole('button', { name: /Call into your web again|Close/ }).first().click().catch(() => {})
    }
    ok('Jakob\'s own phone was never prompted (it holds none of the ten lines)', (await jakob.locator('.overlay.on').count()) === 0)
    const carlState = await record(carl)
    ok('one Jakob node on Carl\'s web, both peers behind it', carlState.people.filter((p) => p.name === 'Jakob').length === 1 && carlState.peers.length === 2)
    await shot(carl, 'b-carl-door-answer')
  } finally {
    vite.stop()
    await peer.stop()
  }
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const scratch = mkdtempSync(path.join(tmpdir(), 'tw-ask-demo-'))
  const publicDir = path.join(scratch, 'public')
  mkdirSync(publicDir)
  const relay = await startRelay()
  const vite = await startVite(PORT, { relayPort: relay.port })
  const browser = await launch()
  try {
    await sectionDemoPage(browser, vite.base)
    vite.stop()
    await sectionFrontDoor(browser, scratch, publicDir, relay)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  exception  ->  ' + (e instanceof Error ? e.stack ?? e.message : String(e)))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
