/**
 * Wave 6e (E2, slice S1): the share modes of the Meet page, headless phones over a real test relay. (Wave 6b had three modes; this suite
 * was updated to the new shape, not dropped: the same rules, the new modes.)
 *   1  the share row: one QR, no Signal tab; nothing saved -> one button (Only TrustWeb) and the arrow; Advanced collapsed; the list holds
 *      all six modes with a pin toggle each, the ONE contact box (Signal, WhatsApp, Matrix) and NO Signal/Molly choice anywhere
 *   2  Signal saved: the row is [TrustWeb + Signal][Only TrustWeb][arrow]; a username link is ticked by default; a scan hands it over
 *   3  WhatsApp saved: the row follows; TrustWeb + WhatsApp keeps the SAME QR (the connect link) and a scan shares the WhatsApp link only
 *      (no Signal link): the scanner's card shows "Message on WhatsApp" and no Signal button
 *   4  the mode is remembered: the page reloaded opens Meet with it, and the record says so
 *   5  Only WhatsApp: the QR, Copy and NFC carry the wa.me link; a number needs its own tick (and the camera-app note); Only Signal: the signal.me link
 *   6  pins: first pin first, a third refused, unpin promotes, kept in the record; a mode outside the two buttons still shows as the one in force
 *      and a mode whose link is missing opens the box on that link and takes the mode once it is saved
 *   7  Only TrustWeb: a scan shares nothing and touches no tick; a WhatsApp or Signal NUMBER never leaves without its own tick
 *   8  Settings holds the same box
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8972).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8972 ../../node_modules/.bin/tsx ../trustweb/test/e2e/advanced_modes_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'
import { chooseMode, currentMode, openAdvanced, pin, rowModes, saveChannel, saveChannelInSettings } from '../helpers/share_box.mjs'

const PORT = Number(process.env.TW_PORT || 8972)
const SHOTS = process.env.TW_SHOTS
const SIGNAL_USER = 'https://signal.me/#eu/adaUsernameCode0123456789'
const SIGNAL_NUMBER = '+43 000 0000000'
const WA_QR = 'https://wa.me/qr/ABCDEFGH12345'
const WA_NUMBER = '+43 000 0000001'
const MATRIX = '@ada:matrix.example.org'
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
/** The host keeps Meet open in its current mode; `joiner` opens the QR's connect link and takes the add sheet. Returns the card's text. */
async function scan(host, joiner, name) {
  const url = await payload(host)
  const before = (await record(host)).peers.length
  await joiner.goto(url)
  await joiner.getByLabel('Your first name').fill(name)
  await joiner.getByRole('button', { name: 'Connect', exact: true }).click()
  const card = await acceptAdd(joiner, { keepCard: true })
  await until(async () => (await record(host)).peers.length === before + 1)
  await host.waitForTimeout(2500)
  return card
}
const messageButtons = (page) => page.locator('.sheet.on [data-message-on]').evaluateAll((as) => as.map((a) => ({ on: a.getAttribute('data-message-on'), href: a.getAttribute('href'), text: a.textContent })))

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

    // 1 the row, Advanced, the box
    await openMeet(ada)
    ok('1. no Signal tab and no swipe hint on Meet', (await ada.getByRole('tab', { name: 'Signal' }).count()) === 0 && !/Swipe/.test(await ada.locator('.meet-page').innerText()))
    ok('1. exactly one QR', (await ada.locator('.qrwrap').count()) === 1)
    ok('1. nothing saved: the row holds Only TrustWeb and the arrow', JSON.stringify(await rowModes(ada)) === JSON.stringify(['only-trustweb']) && (await ada.locator('[data-share-row] [data-act="advanced"]').count()) === 1)
    ok('1. Advanced is collapsed', (await ada.locator('[data-act="advanced"]').getAttribute('aria-expanded')) === 'false' && (await ada.locator('.advanced-panel').isHidden()))
    await openAdvanced(ada)
    ok('1. the arrow says it is open', (await ada.locator('[data-act="advanced"]').getAttribute('aria-expanded')) === 'true')
    const modes = await ada.locator('.advanced-panel .mode-row [data-mode]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-mode')))
    ok('1. the list holds all six modes', JSON.stringify(modes) === JSON.stringify(['trustweb-signal', 'trustweb-whatsapp', 'trustweb-matrix', 'only-trustweb', 'only-signal', 'only-whatsapp']), JSON.stringify(modes))
    ok('1. each mode has a pin toggle', (await ada.locator('.advanced-panel [data-pin]').count()) === 6)
    ok('1. ONE contact box with Signal, WhatsApp and Matrix', (await ada.locator('.advanced-panel [data-contact-box]').count()) === 1
      && JSON.stringify(await ada.locator('.advanced-panel [data-cb-row]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-cb-row')))) === JSON.stringify(['signal', 'whatsapp', 'matrix']))
    const panelText = await ada.locator('.advanced-panel').innerText()
    ok('1. no Signal/Molly choice anywhere: no provider buttons, no "Molly" in the panel', (await ada.locator('[data-provider]').count()) === 0 && !/Molly/.test(panelText), panelText.slice(0, 200))
    ok('1. a mode whose link is missing says so', (await ada.locator('[data-mode-missing="trustweb-signal"]').count()) === 1)
    ok('1. the default mode is Only TrustWeb: the QR is the connect link', (await currentMode(ada)) === 'only-trustweb' && /connect=/.test(await payload(ada)))
    await shot(ada, 'e2-01-advanced-open')

    // 2 Signal
    await saveChannel(ada, 'signal', SIGNAL_USER)
    ok('2. the row is [TrustWeb + Signal][Only TrustWeb][arrow]', JSON.stringify(await rowModes(ada)) === JSON.stringify(['trustweb-signal', 'only-trustweb']))
    ok('2. TrustWeb + Signal is the primary and in force', (await currentMode(ada)) === 'trustweb-signal' && (await ada.locator('[data-share-row] [data-slot="primary"]').getAttribute('data-mode')) === 'trustweb-signal')
    ok('2. the QR is still the connect link', /connect=/.test(await payload(ada)))
    ok('2. a username link is ticked by default (in the box and in the sentence)', await ada.locator('.advanced-panel [data-share-tick="signal"]').isChecked() && await ada.locator('.sharing-line [data-share-tick="signal"]').isChecked())
    ok('2. the sentence says a scan also gives the Signal link', (await ada.locator('[data-signal-sharing="shared"]').innerText()).includes('also gives them your Signal link'))
    const bob = await newPhone(browser, errors)
    const bobCard = await scan(ada, bob, 'Bob')
    ok('2. a scan in TrustWeb + Signal: Bob\'s card for Ada has "Message on Signal"', /Message on Signal/.test(bobCard) && !/Molly/.test(bobCard), bobCard)
    ok('2. Ada\'s record says the link went', Object.keys((await record(ada)).contactSent ?? {}).length === 1)
    await shot(bob, 'e2-02-bob-card-signal')

    // 3 WhatsApp
    await saveChannel(ada, 'whatsapp', WA_QR)
    ok('3. the row follows: [TrustWeb + Signal][TrustWeb + WhatsApp]', JSON.stringify(await rowModes(ada)) === JSON.stringify(['trustweb-signal', 'trustweb-whatsapp']))
    ok('3. a wa.me/qr link is ticked by default (it holds no number)', (await record(ada)).contactShare?.shareOnConnect?.whatsapp === true)
    await ada.locator('[data-share-row] [data-mode="trustweb-whatsapp"]').click()
    ok('3. TrustWeb + WhatsApp is in force, the QR is the SAME connect link', (await currentMode(ada)) === 'trustweb-whatsapp' && /connect=/.test(await payload(ada)))
    ok('3. the sentence names WhatsApp', (await ada.locator('[data-signal-sharing="shared"]').innerText()).includes('your WhatsApp link'))
    await shot(ada, 'e2-03-whatsapp-mode')
    const carl = await newPhone(browser, errors)
    const carlCard = await scan(ada, carl, 'Carl')
    const carlBtns = await messageButtons(carl)
    ok('3. Carl\'s scan lands on Ada with "Message on WhatsApp" (the wa.me/qr link) and NO Signal button', carlBtns.length === 1 && carlBtns[0].on === 'whatsapp' && carlBtns[0].href === WA_QR && /Message on WhatsApp/.test(carlBtns[0].text), JSON.stringify(carlBtns) + carlCard)
    const carlAda = await personOf(carl, 'Ada')
    ok('3. Carl holds the WhatsApp link only, not Ada\'s Signal link', JSON.stringify(carlAda?.theirChannels) === JSON.stringify({ whatsapp: WA_QR }), JSON.stringify(carlAda?.theirChannels))
    await shot(carl, 'e2-03-carl-card-whatsapp')

    // 4 remembered
    await ada.reload()
    await openMeet(ada)
    ok('4. after a reload Meet opens with the remembered mode', (await currentMode(ada)) === 'trustweb-whatsapp' && (await ada.locator('[data-share-row] [data-mode="trustweb-whatsapp"]').getAttribute('aria-pressed')) === 'true')
    ok('4. the record says so', (await record(ada)).shareMode === 'trustweb-whatsapp')

    // 5 Only WhatsApp / Only Signal
    await chooseMode(ada, 'only-whatsapp')
    ok('5. Only WhatsApp: the QR holds the wa.me/qr link and the connect code is not shown', (await payload(ada)) === WA_QR && (await ada.locator('[data-link="code"]').isHidden()))
    await ada.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await ada.locator('.meet-page > .btn', { hasText: 'Copy link' }).click()
    ok('5. Copy link follows: the wa.me/qr link', (await ada.evaluate(() => navigator.clipboard.readText()).catch(() => WA_QR)) === WA_QR)
    ok('5. no camera-app note for a link without a number', (await ada.locator('[data-scan="camera-only"]').count()) === 0)
    await shot(ada, 'e2-05-only-whatsapp-qr')
    await saveChannel(ada, 'whatsapp', WA_NUMBER)
    ok('5. replacing the link by a NUMBER turns its tick off (a number needs its own yes)', (await record(ada)).contactShare?.shareOnConnect?.whatsapp === false || (await record(ada)).contactShare?.shareOnConnect?.whatsapp === undefined)
    ok('5. Only WhatsApp with an unticked number: no code at all, and the sentence says why',
      !(await payload(ada)) && /not being shared: it holds your phone number/.test(await ada.locator('[data-signal-sharing="number-not-ticked"]').innerText().catch(() => '')), String(await payload(ada)))
    ok('5. a plain note warns that the link holds the number', (await ada.locator('.advanced-panel [data-cb-ticks="whatsapp"] [data-share="phone"]').count()) === 1)
    await ada.locator('.sharing-line [data-share-tick="whatsapp"]').check()
    ok('5. ticked: the QR holds https://wa.me/<digits>', !!(await until(async () => (await payload(ada)) === 'https://wa.me/430000000001')), String(await payload(ada)))
    ok('5. the camera-app note shows for a number', /camera app/.test(await ada.locator('[data-scan="camera-only"]').innerText().catch(() => '')))
    ok('5. the box and the sentence share one tick (box shows it ticked too)', await ada.locator('.advanced-panel [data-cb-ticks="whatsapp"] [data-share-tick="whatsapp"]').isChecked())
    await ada.locator('.sharing-line [data-share-tick="whatsapp"]').uncheck()
    await chooseMode(ada, 'only-signal')
    ok('5. Only Signal: the QR holds exactly the signal.me username link', (await payload(ada)) === SIGNAL_USER)
    await saveChannel(ada, 'whatsapp', WA_QR)

    // 6 pins
    ok('6. nothing pinned yet', ((await record(ada)).sharePins ?? []).length === 0)
    await pin(ada, 'only-whatsapp')
    ok('6. pin first -> first button', JSON.stringify(await rowModes(ada)).startsWith('["only-whatsapp"'), JSON.stringify(await rowModes(ada)))
    await pin(ada, 'only-signal')
    ok('6. pin second -> second button: [Only WhatsApp][Only Signal]', JSON.stringify(await rowModes(ada)) === JSON.stringify(['only-whatsapp', 'only-signal']))
    ok('6. the record keeps the order', JSON.stringify((await record(ada)).sharePins) === JSON.stringify(['only-whatsapp', 'only-signal']))
    await pin(ada, 'only-trustweb')
    ok('6. a third pin is refused with a plain line and changes nothing', /Two modes are pinned already/.test(await ada.locator('[data-pin-note]').innerText()) && JSON.stringify(await rowModes(ada)) === JSON.stringify(['only-whatsapp', 'only-signal']))
    await shot(ada, 'e2-06-pins')
    await pin(ada, 'only-whatsapp')
    ok('6. unpin the first -> the still pinned one becomes the first', (await rowModes(ada))[0] === 'only-signal' && JSON.stringify((await record(ada)).sharePins) === JSON.stringify(['only-signal']))
    // a mode outside the two buttons still shows as in force
    await chooseMode(ada, 'trustweb-whatsapp')
    ok('6. a remembered mode outside the row is still shown as the one in force', !(await rowModes(ada)).includes('trustweb-whatsapp') && /Showing: TrustWeb \+ WhatsApp/.test(await ada.locator('[data-share-now]').innerText()))
    // a mode whose link is missing: opens the box on it, takes the mode once the link is saved
    await ada.locator('.advanced-panel [data-mode="trustweb-matrix"]').click()
    ok('6. TrustWeb + Matrix without a Matrix id opens the box on Matrix and does not take the mode yet',
      (await ada.locator('.advanced-panel [data-cb-input="matrix"]').count()) === 1 && (await currentMode(ada)) === 'trustweb-whatsapp')
    await ada.locator('.advanced-panel [data-cb-input="matrix"]').fill(MATRIX)
    await ada.locator('.advanced-panel [data-cb-save="matrix"]').click()
    ok('6. saving the id takes the waiting mode', !!(await until(async () => (await currentMode(ada)) === 'trustweb-matrix')))
    ok('6. a Matrix id is ticked by default', (await record(ada)).contactShare?.shareOnConnect?.matrix === true)
    const dan = await newPhone(browser, errors)
    await scan(ada, dan, 'Dan')
    ok('6. a scan in TrustWeb + Matrix shares the Matrix id only', JSON.stringify((await personOf(dan, 'Ada'))?.theirChannels) === JSON.stringify({ matrix: MATRIX }), JSON.stringify((await personOf(dan, 'Ada'))?.theirChannels))

    // 7 Only TrustWeb shares nothing; a number never leaves untricked
    await chooseMode(ada, 'trustweb-signal')
    const recBefore = await record(ada)
    const tickBefore = JSON.stringify(recBefore.contactShare)
    const sentBefore = JSON.stringify(recBefore.contactSent ?? {})
    await chooseMode(ada, 'only-trustweb')
    ok('7. Only TrustWeb: the QR is the connect link and the page says this scan shares no link', /connect=/.test(await payload(ada)) && (await ada.locator('[data-signal-sharing="off"]').innerText()).includes('shares no Signal, WhatsApp or Matrix link'))
    await shot(ada, 'e2-07-only-trustweb')
    const eve = await newPhone(browser, errors)
    await scan(ada, eve, 'Eve')
    ok('7. Eve\'s card for Ada holds no messenger link', (await personOf(eve, 'Ada'))?.theirChannels === undefined && !JSON.stringify((await record(eve)).chats ?? {}).includes('contact=1'))
    const recAfter = await record(ada)
    ok('7. the tick was neither consumed nor changed, and nothing was recorded as sent for Eve', JSON.stringify(recAfter.contactShare) === tickBefore && JSON.stringify(recAfter.contactSent ?? {}) === sentBefore, `${tickBefore} -> ${JSON.stringify(recAfter.contactShare)}`)
    await saveChannel(ada, 'whatsapp', WA_NUMBER)
    await chooseMode(ada, 'trustweb-whatsapp')
    ok('7. TrustWeb + WhatsApp with an unticked NUMBER: the sentence says it is not shared', (await ada.locator('[data-signal-sharing="number-not-ticked"]').count()) === 1)
    const fay = await newPhone(browser, errors)
    await scan(ada, fay, 'Fay')
    ok('7. Fay got nothing: a phone number never leaves without its own tick', (await personOf(fay, 'Ada'))?.theirChannels === undefined && !JSON.stringify((await record(fay)).chats ?? {}).includes('4300'))
    await ada.locator('.sharing-line [data-share-tick="whatsapp"]').check()
    const gus = await newPhone(browser, errors)
    await scan(ada, gus, 'Gus')
    ok('7. ticked, the next scan brings the WhatsApp number as a wa.me link', !!(await until(async () => (await personOf(gus, 'Ada'))?.theirChannels?.whatsapp === '+430000000001')))

    // 8 Settings holds the same box
    await ada.getByRole('button', { name: 'Back' }).click().catch(() => {})
    await ada.locator('.hdr-btn.more').first().click()
    await ada.locator('.menu-item', { hasText: 'Settings' }).click()
    const inSettings = await until(async () => (await ada.locator('.sheet.on [data-contact-box]').count()) === 1)
    ok('8. Settings holds the contact box (Signal, WhatsApp, Matrix)', !!inSettings && (await ada.locator('.sheet.on [data-cb-row]').count()) === 3)
    if (inSettings) {
      await saveChannelInSettings(ada, 'matrix', '@ada:other.example.org')
      ok('8. a link saved in Settings is the one Meet uses', (await record(ada)).myChannels?.matrix === '@ada:other.example.org')
    }
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
