// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c sync-devices: ONE person with a laptop (1280x900) and a phone (360x780), plus two other people, a real RelayServer behind the Vite
 * /relay proxy, stock data only:
 *   1. Laptop and phone link (Settings > My devices, code, same 4 characters, Confirm on both). Settings shows "Devices in sync: 1" and an
 *      Auto sync switch (on, aria-pressed=true); switching it off strikes it through (P2).
 *   2. Other scans the LAPTOP's code. Without any tap on the phone, the phone shows Other (card + connection) within one tick (measured).
 *   3. The phone opens Other's card, chats; Other receives it (the laptop told Other the phone's DID); Other's answer reaches the phone.
 *   4. The phone shows its code; Other2 scans it: the phone has Other2 at once, the laptop within one tick.
 *   5. No duplicate cards, no duplicate chat rows on either device; the relay carried no name in plaintext.
 * Run from apps/demo (PORT 5451):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=5451 ../../node_modules/.bin/tsx ../trustweb/test/e2e/sync_devices.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'
import { plainHits, wireKind } from '../helpers/relay_plain.mjs'

const PORT = Number(process.env.TW_PORT || 5451)
const SHOTS = process.env.TW_SHOTS
const TICK_MS = 15_000
/** review-fixes-43c: a new connection kicks a round (sync_view.ts KICK_MS 0.8 s), so the other device has it within seconds, not a tick. */
const KICK_BUDGET_MS = 6_000
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-devices-${name}.png`) }) }
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const closeSheet = (page) => page.locator('.sheet.on .sheet-home').click().catch(() => {})

async function openDevices(page) {
  await tab(page, 'Web')
  await page.evaluate(() => localStorage.setItem('trustweb.ui.settings.devices', '1'))
  await page.locator('.hdr [aria-label="Settings"]').click()
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
  await page.locator('[data-open-devices]').click()
  await page.getByRole('heading', { name: 'My devices' }).waitFor({ timeout: 10_000 })
}

/** `joiner` opens `host`'s code and connects (one scan, add sheet answered). */
async function scan(host, joiner, base) {
  await tab(host, 'Web')
  await host.locator('.hdr [aria-label^="Show my code"]').click()
  await host.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  // the code names the public app origin; the test opens the same link on this dev server (never the live site)
  const url = (await host.getAttribute('.qrwrap', 'data-payload')).replace(/^https?:\/\/[^/]+\//, base)
  if (!url.startsWith(base)) throw new Error('not a local link: ' + url.slice(0, 40))
  await joiner.goto(url)
  await acceptAdd(joiner)
  await host.getByRole('button', { name: 'Back' }).click().catch(() => {})
}

const peopleNamed = async (page, name) => (await record(page)).people.filter((p) => !p.deleted_at && p.name === name)

async function main() {
  const tap = []
  const relay = await startRelay({ port: PORT, tap })
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log('sync-devices against ' + vite.base)
  const browser = await launch()
  const bodies = []
  try {
    const laptop = await newPhone(browser, errors, { viewport: { width: 1280, height: 900 } })
    const phone = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    const other = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    const other2 = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
    for (const p of [laptop, phone]) p.on('request', (r) => { if (r.url().includes('/relay/send')) bodies.push(r.postData() ?? '') })
    // the dev server's review panel is not part of the app (as in sync_visibility.mjs)
    for (const p of [laptop, phone, other, other2]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(laptop, vite.base, 'Jakob')
    await startPhone(phone, vite.base, 'Jakob')
    await startPhone(other, vite.base, 'Other')
    await startPhone(other2, vite.base, 'Otto')
    await laptop.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Laptop'))
    await phone.evaluate(() => localStorage.setItem('trustweb.v1.me:device-name', 'Phone'))

    // 1. link
    await openDevices(laptop)
    await laptop.locator('[data-link-device]').click()
    const code = (await laptop.locator('[data-device-code]').innerText()).trim()
    await openDevices(phone)
    await phone.locator('[data-enter-code]').click()
    await phone.locator('[data-code-input]').fill(code)
    await phone.locator('[data-code-ok]').click()
    await phone.locator('[data-pair-confirm]').waitFor({ timeout: 20_000 })
    await until(() => laptop.locator('[data-pair-confirm]').isVisible())
    await phone.locator('[data-pair-confirm]').click()
    await laptop.locator('[data-pair-confirm]').click()
    ok('1. both list the other device', (await phone.locator('[data-device]').count()) === 1 && (await laptop.locator('[data-device]').count()) === 1)
    const line = await phone.locator('[data-sync-status-line]').innerText()
    ok('1. My devices says "Devices in sync: 1"', /^Devices in sync: 1, last /.test(line), line)
    const auto = phone.locator('[data-sync-auto]')
    ok('1. Auto sync is on (aria-pressed=true, not struck through)', (await auto.getAttribute('aria-pressed')) === 'true' && !(await auto.getAttribute('class')).includes('tw-off'))
    await auto.click()
    const off = phone.locator('[data-sync-auto]')
    await phone.addStyleTag({ content: 'html .tw-off{text-decoration:line-through}' })   // wave 44: the line is opt-in now (Settings > Variations)
    ok('1. off: struck through and aria-pressed=false (P2), stored on this device', (await off.getAttribute('aria-pressed')) === 'false' && (await off.evaluate((e) => getComputedStyle(e).textDecorationLine)).includes('line-through') && (await record(phone)).syncAutoOff === true)
    await shot(phone, 'auto-off-360')
    await off.click()
    ok('1. on again', (await phone.locator('[data-sync-auto]').getAttribute('aria-pressed')) === 'true' && (await record(phone)).syncAutoOff === undefined)
    await shot(phone, 'devices-360')
    await shot(laptop, 'devices-1280')
    await closeSheet(phone); await closeSheet(laptop)

    // 2. Other connects with the laptop; the phone shows Other without any tap
    await scan(laptop, other, vite.base)
    const onLaptop = await until(async () => (await record(laptop)).people.find((p) => p.name === 'Other' && p.peerId))
    ok('2. the laptop has Other', !!onLaptop)
    const t0 = Date.now()
    const onPhone = await until(async () => { const r = await record(phone); return r.people.find((p) => p.peerId === onLaptop.peerId) && r.peers.some((x) => x.id === onLaptop.peerId) ? r : null }, 2 * TICK_MS + 15_000)
    const took = Date.now() - t0
    console.log(`  measured: Other reached the phone ${took} ms after the laptop had the card`)
    ok(`2. the phone shows Other with the connection, within one tick (+ delivery): ${took} ms`, !!onPhone && took <= TICK_MS + 10_000, String(took))
    ok(`2. ... and without waiting for the tick (kick on connect, <= ${KICK_BUDGET_MS} ms): ${took} ms`, !!onPhone && took <= KICK_BUDGET_MS, String(took))

    // 3. the phone chats with Other; Other answers to the phone
    await until(async () => (await record(other)).peers.some((p) => (p.alsoDids ?? []).length), 2 * TICK_MS + 10_000)
    ok('3. Other knows Jakob\'s phone (alsoDids, told by the laptop)', (await record(other)).peers.length === 1 && ((await record(other)).peers[0].alsoDids ?? []).length === 1)
    await tab(phone, 'Web')
    await phone.locator('.node', { hasText: 'Other' }).first().click()
    await phone.locator('[data-chat-open]:visible').first().click()
    await phone.getByPlaceholder('Write a message', { exact: true }).fill('from the phone')
    await phone.getByRole('button', { name: 'Send', exact: true }).click()
    const got = await until(async () => JSON.stringify((await record(other)).chats ?? {}).includes('from the phone'), 20_000)
    ok('3. Other receives the phone\'s message', !!got)
    await shot(phone, 'chat-360')
    const otherRec = await record(other)
    const meOnOther = otherRec.people.filter((p) => !p.deleted_at && p.peerId)
    ok('3. Other still has ONE card for Jakob (no second connection from the phone)', otherRec.peers.length === 1 && meOnOther.length === 1, JSON.stringify(meOnOther.map((p) => p.name)))
    await other.evaluate(() => document.querySelector('.sheet.on .sheet-home')?.click())
    await tab(other, 'Web')
    await other.locator('.node', { hasText: 'Jakob' }).first().click()
    await other.locator('[data-chat-open]:visible').first().click()
    await other.getByPlaceholder('Write a message', { exact: true }).fill('answer from Other')
    await other.getByRole('button', { name: 'Send', exact: true }).click()
    const back = await until(async () => JSON.stringify((await record(phone)).chats ?? {}).includes('answer from Other') && JSON.stringify((await record(laptop)).chats ?? {}).includes('answer from Other'), 20_000)
    ok('3. Other\'s answer reaches the phone and the laptop', !!back)
    await closeSheet(phone)

    // 4. the phone shows its code, Other2 scans it
    await scan(phone, other2, vite.base)
    const o2 = await until(async () => (await record(phone)).people.find((p) => p.name === 'Otto' && p.peerId), 20_000)
    ok('4. the showing phone has Otto at once (card + connection)', !!o2 && (await record(phone)).peers.some((x) => x.id === o2.peerId))
    const t4 = Date.now()
    const o2Laptop = await until(async () => { const r = await record(laptop); return r.people.find((p) => p.peerId === o2?.peerId) && r.peers.some((x) => x.id === o2?.peerId) }, 2 * TICK_MS + 15_000)
    const took4 = Date.now() - t4
    console.log(`  measured: Otto reached the laptop ${took4} ms after the phone had the card`)
    ok(`4. the laptop has Otto (card + connection) within one tick (+ delivery): ${took4} ms`, !!o2Laptop && took4 <= TICK_MS + 10_000, String(took4))
    ok(`4. ... and without waiting for the tick (kick on connect, <= ${KICK_BUDGET_MS} ms): ${took4} ms`, !!o2Laptop && took4 <= KICK_BUDGET_MS, String(took4))

    // 5. no duplicates
    await new Promise((r) => setTimeout(r, TICK_MS + 2000))
    for (const [name, page] of [['laptop', laptop], ['phone', phone]]) {
      ok(`5. ${name}: one card each for Other and Otto`, (await peopleNamed(page, 'Other')).length === 1 && (await peopleNamed(page, 'Otto')).length === 1)
      await tab(page, 'Chat')
      const rows = await page.locator('[data-chat-row], [data-chat-newly-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-row') ?? e.getAttribute('data-chat-newly-row')))
      ok(`5. ${name}: no duplicate rows in the chat list (a person once, "Newly added" included)`, rows.length >= 1 && new Set(rows).size === rows.length, JSON.stringify(rows))
    }
    await shot(phone, 'chat-list-360')
    await shot(laptop, 'chat-list-1280')
    ok('5. the relay carried sealed text only', bodies.length > 0 && bodies.every((b) => !/Other|Otto|from the phone/.test(b)), `${bodies.length} bodies`)
    // review-fixes-43c: what the relay STORED (every wire, any transport), raw and base64-decoded
    const NAMES = ['Jakob', 'Other', 'Otto', 'Laptop', 'Phone', 'from the phone', 'answer from Other']
    const sealed = tap.filter((w) => wireKind(w.wire) !== 'connect-ack')
    const leaks = sealed.map((w) => plainHits(w.wire, NAMES)).filter((h) => h.length)
    ok(`5. relay store: ${sealed.length} sync/chat/devices wires, no name, device name or chat text readable`, sealed.length > 5 && leaks.length === 0, JSON.stringify(leaks.slice(0, 3)))
    const acks = tap.filter((w) => wireKind(w.wire) === 'connect-ack').map((w) => plainHits(w.wire, NAMES))
    console.log(`  relay store: ${tap.length} wires, ${acks.length} cleartext connect-acks carrying ${JSON.stringify([...new Set(acks.flat())])} (the scanner's own name, connect_link.ts bootstrap)`)
    ok('5. a cleartext connect-ack carries only the scanner\'s own name, never chat text or the device names', acks.every((h) => h.every((n) => n === 'Other' || n === 'Otto' || n === 'Jakob')))
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
