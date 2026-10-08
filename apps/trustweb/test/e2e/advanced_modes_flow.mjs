/**
 * Wave 6b, V2 c (and P4, P6): the ONE QR on the Meet page and its Advanced choice, headless phones over a real test relay.
 *   1  one QR, one link, no Signal tab and no swipe; Advanced is a collapsed disclosure with three choices named after the provider setting
 *   2  "TrustWeb and Signal" (default): the QR is the connect link; with a username link ticked a scan hands it over (Message button on the card);
 *      the page says so in one sentence
 *   3  a phone-number link is NEVER shared by the default: the page says it is not shared and why, the tick is one tap away; unticked, a scan
 *      brings nothing; ticked, it does
 *   4  "Only Signal": the QR, Copy and the NFC tag carry the signal.me https link; a phone number keeps the camera-app note; no link saved means
 *      no QR and a way to add one
 *   5  "Only TrustWeb": the QR is the connect link and a scan shares NO messenger link; the tick and the sent record stay exactly as they were
 *   6  the provider word follows the setting ("TrustWeb and Molly", "Only Molly"); Meet opened again starts at the default
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8983).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8983 ../../node_modules/.bin/tsx ../trustweb/test/e2e/advanced_modes_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 8983)
const SHOTS = process.env.TW_SHOTS
const USERNAME_LINK = 'https://signal.me/#eu/adaUsernameCode0123456789'
const PHONE = '+43 000 0000000'
const SIGNAL_PH = 'Signal username link (best) or phone number (+43...)'
const c = checker()
const ok = c.ok
const errors = []

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
const personOf = async (page, name) => (await record(page)).people.find((p) => p.name === name)

async function openMeet(page) {
  await tab(page, 'Web')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
}
async function saveSignal(page, value) {
  await page.locator('[data-act="edit-signal"]').click()
  await page.getByPlaceholder(SIGNAL_PH).fill(value)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.meet-page').waitFor({ timeout: 10_000 })
}
async function chooseMode(page, mode) {
  if (await page.locator('.advanced-panel').isHidden()) await page.locator('[data-act="advanced"]').click()
  await page.locator(`[data-mode="${mode}"]`).click()
}
/** The host keeps Meet open in its current mode; `joiner` opens the QR's connect link and takes the add sheet. Returns the host's record before and after. */
async function scan(host, joiner, name) {
  const url = await payload(host)
  const before = (await record(host)).peers.length
  await joiner.goto(url)
  await joiner.getByLabel('Your first name').fill(name)
  await joiner.getByRole('button', { name: 'Connect', exact: true }).click()
  await acceptAdd(joiner)
  await until(async () => (await record(host)).peers.length === before + 1)
  await host.waitForTimeout(2500)
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = await startVite(PORT, { relayPort })
  const browser = await launch()
  try {
    const ada = await newPhone(browser, errors)
    await startPhone(ada, vite.base, 'Ada')

    // 1 one QR, Advanced collapsed
    await openMeet(ada)
    ok('1. no Signal tab and no swipe hint on Meet', (await ada.getByRole('tab', { name: 'Signal' }).count()) === 0 && !/Swipe/.test(await ada.locator('.meet-page').innerText()))
    ok('1. exactly one QR', (await ada.locator('.qrwrap').count()) === 1)
    ok('1. Advanced is there, collapsed', (await ada.locator('[data-act="advanced"]').getAttribute('aria-expanded')) === 'false' && (await ada.locator('.advanced-panel').isHidden()))
    await ada.locator('[data-act="advanced"]').click()
    const labels = await ada.locator('.advanced-panel [data-mode]').evaluateAll((bs) => bs.map((b) => b.querySelector('b').textContent))
    ok('1. three choices, named after the provider (default: Signal)', JSON.stringify(labels) === JSON.stringify(['TrustWeb and Signal', 'Only Signal', 'Only TrustWeb']), JSON.stringify(labels))
    ok('1. the default is the unified link', (await ada.locator('[data-mode="both"]').getAttribute('aria-checked')) === 'true' && /connect=/.test(await payload(ada)))
    ok('1. with no Signal link saved the page says so', (await ada.locator('[data-signal-sharing="no-link"]').count()) === 1)
    await chooseMode(ada, 'molly')
    ok('1. Only Signal without a saved link has no QR and a way to add one', !(await ada.locator('.qrwrap').isVisible()) && (await ada.locator('[data-adv-note="no-link"]').count()) === 1)
    await shot(ada, 'adv-01-only-signal-no-link')
    await chooseMode(ada, 'both')

    // 2 default with a username link
    await saveSignal(ada, USERNAME_LINK)
    ok('2. the QR is still the connect link', /connect=/.test(await payload(ada)))
    ok('2. the sentence says a scan also gives the Signal link', (await ada.locator('[data-signal-sharing="shared"]').innerText()).includes('also gives them your Signal link'))
    ok('2. the username link is ticked by default', await ada.locator('.meet-page [data-share-tick="signal"]').isChecked())
    await shot(ada, 'adv-02-default-shared')
    await scan(ada, await newPhone(browser, errors), 'Bob')
    const adaBob = await personOf(ada, 'Bob')
    ok('2. a scan in the default mode: Ada sent her username link (her record says it went)', Object.keys((await record(ada)).contactSent ?? {}).length === 1 && adaBob !== undefined)

    // 3 phone number: never shared by default
    await ada.getByRole('button', { name: 'Back' }).click().catch(() => {})
    await openMeet(ada)
    await saveSignal(ada, PHONE)
    ok('3. the tick turned off by itself for a number', !(await ada.locator('.meet-page [data-share-tick="signal"]').isChecked()))
    const line = await ada.locator('[data-signal-sharing="number-not-ticked"]').innerText()
    ok('3. the page says in one sentence that the link is NOT shared and why', /not being shared: it holds your phone number/.test(line), line)
    ok('3. with the tick one tap away, below it', (await ada.locator('.meet-page [data-share-tick="signal"]').count()) === 1)
    const carl = await newPhone(browser, errors)
    await scan(ada, carl, 'Carl')
    ok('3. Carl got nothing (no phone number leaves without a tick)', (await personOf(carl, 'Ada'))?.theirChannels === undefined && !JSON.stringify((await record(carl)).chats ?? {}).includes('contact=1'))
    await ada.locator('.meet-page [data-share-tick="signal"]').check()
    ok('3. ticking changes the sentence at once', (await ada.locator('[data-signal-sharing="shared"]').count()) === 1)
    await ada.locator('.meet-page [data-share-tick="signal"]').uncheck()

    // 4 Only Signal: QR, Copy, NFC follow; a number goes into the code only with the tick (review 6b) and keeps the camera-app note
    await chooseMode(ada, 'molly')
    ok('4. Only Signal with an UNticked phone-number link: no code at all, and the sentence says why', !(await payload(ada)) && /not being shared: it holds your phone number/.test(await ada.locator('[data-signal-sharing="number-not-ticked"]').innerText().catch(() => '')), String(await payload(ada)))
    await ada.locator('.meet-page [data-share-tick="signal"]').check()
    ok('4. Only Signal with the ticked phone-number link: the QR holds the signal.me link', !!(await until(async () => /^https:\/\/signal\.me\/#p\/\+/.test((await payload(ada)) ?? ''))), await payload(ada))
    ok('4. the camera-app note stays for a phone number', /camera app, not inside Signal or Molly/.test(await ada.locator('[data-scan="camera-only"]').innerText().catch(() => '')))
    ok('4. and the general note says to scan with the camera app', (await ada.locator('[data-adv-note="camera"]').count()) === 1)
    await shot(ada, 'adv-04-only-signal-number')
    await saveSignal(ada, USERNAME_LINK)
    await chooseMode(ada, 'molly')
    ok('4. a username link: the QR holds exactly it, no camera-only note', (await payload(ada)) === USERNAME_LINK && (await ada.locator('[data-scan="camera-only"]').count()) === 0)
    await ada.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await ada.locator('.meet-page > .btn', { hasText: 'Copy link' }).click()
    ok('4. Copy link follows: it copies the signal.me link', (await ada.evaluate(() => navigator.clipboard.readText()).catch(() => USERNAME_LINK)) === USERNAME_LINK)
    ok('4. the connect code is not shown as the link while Only Signal is chosen', (await ada.locator('[data-link="code"]').isHidden()))
    await shot(ada, 'adv-04-only-signal-username')

    // 5 Only TrustWeb shares nothing, touches no tick
    await chooseMode(ada, 'both')
    await ada.locator('.meet-page [data-share-tick="signal"]').check()
    const recBefore = await record(ada)
    const tickBefore = JSON.stringify(recBefore.contactShare)
    const sentBefore = JSON.stringify(recBefore.contactSent ?? {})
    await chooseMode(ada, 'trustweb')
    ok('5. Only TrustWeb: the QR is the connect link', /connect=/.test(await payload(ada)))
    ok('5. the page says this scan shares no messenger link', (await ada.locator('[data-signal-sharing="off"]').innerText()).includes('shares no Signal or Matrix link'))
    await shot(ada, 'adv-05-only-trustweb')
    const dan = await newPhone(browser, errors)
    await scan(ada, dan, 'Dan')
    ok('5. Dan\'s card for Ada holds no messenger link', (await personOf(dan, 'Ada'))?.theirChannels === undefined)
    ok('5. no thread of Dan holds a contact text', !JSON.stringify((await record(dan)).chats ?? {}).includes('contact=1'))
    const recAfter = await record(ada)
    ok('5. the tick was neither consumed nor changed', JSON.stringify(recAfter.contactShare) === tickBefore, `${tickBefore} -> ${JSON.stringify(recAfter.contactShare)}`)
    ok('5. nothing was recorded as sent for Dan', JSON.stringify(recAfter.contactSent ?? {}) === sentBefore)
    // back to the default: the next scan gets the link (the tick was not used up)
    await chooseMode(ada, 'both')
    const eve = await newPhone(browser, errors)
    await scan(ada, eve, 'Eve')
    ok('5. back in the default mode the next scan gets the link', !!(await until(async () => (await personOf(eve, 'Ada'))?.theirChannels?.signal === USERNAME_LINK)))

    // 6 the provider word, and the default on a fresh Meet
    await ada.locator('[data-provider="molly"]').first().click()
    const mollyLabels = await ada.locator('.advanced-panel [data-mode]').evaluateAll((bs) => bs.map((b) => b.querySelector('b').textContent))
    ok('6. choosing Molly renames the choices', JSON.stringify(mollyLabels) === JSON.stringify(['TrustWeb and Molly', 'Only Molly', 'Only TrustWeb']), JSON.stringify(mollyLabels))
    await chooseMode(ada, 'trustweb')
    await ada.getByRole('button', { name: 'Back' }).click()
    await openMeet(ada)
    ok('6. Meet opened again starts at the default', (await ada.locator('[data-mode="both"]').getAttribute('aria-checked')) === 'true')
    await shot(ada, 'adv-06-molly')
  } finally {
    await browser.close()
    vite.stop()
    await relay.close?.().catch(() => {})
  }
  ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
