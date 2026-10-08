/**
 * Wave 6 (U4 g): connect shares a contact, the Signal sheet, chat, over the test relay with headless phones
 * (cases 1 to 6 of wave6/u3_hooks.txt section E; case 5 is covered by unit tests: a meeting share link sent as a
 * chat text is routed to the received-share notice by chat.ts routeText and never lands in a thread).
 *   1. Alice saves a signal.me USERNAME link on the Meet page (Signal tab): the tick appears on, the QR holds that
 *      link and no camera-app note shows. Bob scans her code: his card for Alice shows "Message on Signal" and
 *      "Shared by Alice when you connected"; theirChannels holds the link, his own `channels` for her stays empty.
 *   2. Bob saves a PHONE NUMBER: never pre-ticked, a plain note says so, the QR note says "camera app". Carl scans
 *      Bob's code: nothing arrives, no thread holds the contact text.
 *   3. Alice replaces her username link by a phone number: the tick turns off by itself and the number note shows.
 *   4. Chat: Bob writes to Alice; Alice (sheet closed) gets the toast, opens the chat and answers; both read both.
 *   5. The relay goes away: Bob's message waits ("Waiting", the offline note); the relay comes back: it arrives
 *      once, not twice.
 *   6. Reload keeps the threads; a corrupted `chats` value is repaired at startup and the app starts.
 *
 * Local only: relay on an ephemeral port (restarted on the same port in step 5), Vite on TW_PORT (default 8970).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/chat_contact_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const SHOTS = process.env.TW_SHOTS
const USERNAME_LINK = 'https://signal.me/#eu/aliceUsernameCode0123456789'
const PHONE = '+43 660 1234567'
const c = checker()
const ok = c.ok
const errors = []

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const SIGNAL_PH = 'Signal username link (best) or phone number (+43...)'

async function startRelayOn(store, port = 0) {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const relay = new RelayServer({ queueStore: store })
  const out = await relay.listen(port, '127.0.0.1')
  return { relay, port: out.port }
}

/** Opens the Meet page's Signal tab. */
async function openSignalTab(page) {
  await tab(page, 'Web')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.getByRole('tab', { name: 'Signal' }).click()
}

/** On the Signal tab: type the value and save. */
async function saveSignal(page, value) {
  await page.getByPlaceholder(SIGNAL_PH).fill(value)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

/** `joiner` opens `host`'s TrustWeb code and connects (one scan). */
async function connect(host, joiner, joinerName, fresh) {
  await tab(host, 'Web')
  await host.locator('.hdr [aria-label^="Show my code"]').click()
  await host.getByRole('tab', { name: 'TrustWeb' }).click()
  await host.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await host.getAttribute('.qrwrap', 'data-payload')
  const before = (await record(host)).peers.length
  await joiner.goto(url)
  if (fresh) {
    await joiner.getByLabel('Your first name').fill(joinerName)
    await joiner.getByRole('button', { name: 'Connect', exact: true }).click()
  }
  await acceptAdd(joiner)
  await until(async () => (await record(host)).peers.length === before + 1)
  await host.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await joiner.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
}

async function openPerson(page, name) {
  await tab(page, 'Web')
  await page.locator('.node', { hasText: name }).first().click()
  await page.locator('.sheet.on').waitFor({ timeout: 5_000 })
}

const personOf = async (page, name) => (await record(page)).people.find((p) => p.name === name)

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const store = new InMemoryRelayQueueStore()
  let relay = await startRelayOn(store)
  const vite = await startVite(PORT, { relayPort: relay.port })
  const browser = await launch()
  try {
    const alice = await newPhone(browser, errors)
    const bob = await newPhone(browser, errors)
    const carl = await newPhone(browser, errors)
    await startPhone(alice, vite.base, 'Alice')

    // 1. a username link: ticked by default, scans anywhere, shared on connect
    await openSignalTab(alice)
    await saveSignal(alice, USERNAME_LINK)
    await alice.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    ok('1. the QR holds the username link', (await alice.getAttribute('.qrwrap', 'data-payload')) === USERNAME_LINK)
    ok('1. no camera-app note for a username code', (await alice.locator('[data-scan="camera-only"]').count()) === 0)
    ok('1. the share tick is on by itself for a username link', await alice.locator('[data-share-tick="signal"]').isChecked())
    ok('1. the record says so', (await record(alice)).contactShare?.shareOnConnect?.signal === true)
    await shot(alice, 'chat-01-alice-signal-tab')
    await connect(alice, bob, 'Bob', true)
    const bobCardOfAlice = await until(async () => (await personOf(bob, 'Alice'))?.theirChannels?.signal)
    ok('1. Bob\'s card for Alice holds her username link as THEIR channel', bobCardOfAlice === USERNAME_LINK, String(bobCardOfAlice))
    ok('1. and his own `channels` for her stays empty', (await personOf(bob, 'Alice')).channels === undefined)
    await openPerson(bob, 'Alice')
    const sheetText = await bob.locator('.sheet.on').innerText()
    ok('1. the card says "Message on Signal" and "Shared by Alice when you connected"', /Message on Signal/.test(sheetText) && /Shared by Alice when you connected/.test(sheetText), sheetText)
    ok('1. the chat button is there (Alice is connected)', (await bob.locator('.sheet.on [data-chat-open]').count()) === 1)
    await shot(bob, 'chat-02-bob-card-of-alice')
    await closeSheet(bob)
    ok('1. Alice\'s card for Bob holds nothing (Bob shared nothing)', (await personOf(alice, 'Bob'))?.theirChannels === undefined)

    // 2. a phone number is never pre-ticked and nothing travels
    await openSignalTab(bob)
    await saveSignal(bob, PHONE)
    await bob.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    ok('2. the share tick stays OFF for a phone number', !(await bob.locator('[data-share-tick="signal"]').isChecked()))
    ok('2. a plain note says the link holds the number', (await bob.locator('[data-share="phone"]').count()) === 1)
    ok('2. the QR note says: camera app, not inside Signal or Molly', /camera app, not inside Signal or Molly/.test(await bob.locator('[data-scan="camera-only"]').innerText().catch(() => '')))
    await shot(bob, 'chat-03-bob-phone-number')
    await connect(bob, carl, 'Carl', true)
    await new Promise((r) => setTimeout(r, 3_000))
    const carlSees = await personOf(carl, 'Bob')
    ok('2. Carl\'s card for Bob holds no contact', Boolean(carlSees) && carlSees.theirChannels === undefined)
    ok('2. no thread of Carl holds the contact text', !JSON.stringify((await record(carl)).chats ?? {}).includes('contact=1'))

    // 3. replacing the username link by a number turns the tick off
    await openSignalTab(alice)
    await alice.getByRole('button', { name: /Change your Signal/ }).click()
    await alice.getByPlaceholder(SIGNAL_PH).fill(PHONE)
    await alice.getByRole('button', { name: 'Save', exact: true }).click()
    await until(async () => (await record(alice)).myChannels?.signal?.includes('#p/'))
    ok('3. the saved link is now a phone number', /^\+436601234567$/.test((await record(alice)).myChannels.signal), (await record(alice)).myChannels?.signal)
    ok('3. the tick turned OFF by itself (a number needs its own yes)', (await record(alice)).contactShare?.shareOnConnect?.signal !== true)
    // put the username link back so later steps can rely on it
    await alice.getByRole('button', { name: /Change your Signal/ }).click()
    await alice.getByPlaceholder(SIGNAL_PH).fill(USERNAME_LINK)
    await alice.getByRole('button', { name: 'Save', exact: true }).click()

    // 4. chat
    await openPerson(bob, 'Alice')
    await bob.locator('.sheet.on [data-chat-open]').click()
    await bob.getByPlaceholder('Write a message').fill('hello Alice')
    await bob.getByRole('button', { name: 'Send', exact: true }).click()
    await bob.locator('.chat-msg.chat-out', { hasText: 'hello Alice' }).waitFor({ timeout: 10_000 })
    await alice.locator('.toast.on', { hasText: 'New message from Bob' }).waitFor({ timeout: 20_000 })
    ok('4. Alice (sheet closed) gets the toast "New message from Bob"', true)
    await openPerson(alice, 'Bob')
    await alice.locator('.sheet.on [data-chat-open]').click()
    await alice.locator('.chat-msg.chat-in', { hasText: 'hello Alice' }).waitFor({ timeout: 10_000 })
    ok('4. she opens the chat and reads it', true)
    await alice.getByPlaceholder('Write a message').fill('hello Bob')
    await alice.getByRole('button', { name: 'Send', exact: true }).click()
    await bob.locator('.chat-msg.chat-in', { hasText: 'hello Bob' }).waitFor({ timeout: 20_000 })
    ok('4. Bob (chat open) sees the answer at once', true)
    ok('4. the sent message reads "Sent"', /Sent/.test(await bob.locator('.chat-msg.chat-out', { hasText: 'hello Alice' }).innerText()))
    await shot(bob, 'chat-04-bob-thread')
    await closeSheet(bob); await closeSheet(alice)

    // 5. the relay goes away: the message waits, then arrives once
    await relay.relay.close()
    await bob.waitForTimeout(500)
    await openPerson(bob, 'Alice')
    await bob.locator('.sheet.on [data-chat-open]').click()
    await bob.getByPlaceholder('Write a message').fill('sent while the relay was down')
    await bob.getByRole('button', { name: 'Send', exact: true }).click()
    await bob.locator('.chat-msg.chat-out', { hasText: 'sent while the relay was down' }).waitFor({ timeout: 10_000 })
    const waiting = await bob.locator('.chat-msg.chat-out', { hasText: 'sent while the relay was down' }).innerText()
    ok('5. offline: the message waits ("Waiting") and the offline note shows', /Waiting/.test(waiting) && (await bob.locator('[data-chat="offline"]').count()) === 1, waiting)
    await shot(bob, 'chat-05-bob-waiting')
    relay = await startRelayOn(store, relay.port)
    await alice.locator('.toast.on', { hasText: 'New message from Bob' }).waitFor({ timeout: 90_000 }).catch(() => {})
    const arrived = await until(async () => (await record(alice)).chats && JSON.stringify((await record(alice)).chats).includes('sent while the relay was down'), 90_000)
    ok('5. the relay is back: the message arrives', Boolean(arrived))
    await new Promise((r) => setTimeout(r, 4_000))
    const copies = (JSON.stringify((await record(alice)).chats).match(/sent while the relay was down/g) ?? []).length
    ok('5. and once, not twice', copies === 1, String(copies))
    ok('5. Bob\'s record marks it delivered', JSON.stringify((await record(bob)).chats).includes('"state":"delivered"') && !/"state":"pending"/.test(JSON.stringify((await record(bob)).chats)))
    ok('5. and his open chat shows it as sent now, without a reopen', await until(async () => !/Waiting/.test(await bob.locator('.chat-msg.chat-out', { hasText: 'sent while the relay was down' }).innerText()), 30_000) !== null)
    await closeSheet(bob)

    // 6. reload keeps the threads; a corrupted value is repaired
    await alice.reload()
    await alice.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    const kept = (await record(alice)).chats
    ok('6. after a reload the thread with Bob is still there', JSON.stringify(kept).includes('hello Alice') && JSON.stringify(kept).includes('hello Bob'))
    await bob.evaluate(() => {
      const k = 'trustweb.v1.me'
      const s = JSON.parse(localStorage.getItem(k))
      s.chats = 'x'
      localStorage.setItem(k, JSON.stringify(s))
    })
    await bob.reload()
    await bob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    const repaired = (await record(bob)).chats
    ok('6. a corrupted `chats` value is repaired at startup and the app starts', typeof repaired === 'object' && repaired !== null && !Array.isArray(repaired), JSON.stringify(repaired))
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.relay.close().catch(() => {})
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
