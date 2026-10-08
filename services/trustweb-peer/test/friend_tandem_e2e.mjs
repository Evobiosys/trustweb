/**
 * Wave 6d end to end: a demo guest asks the demo front door (named Jakob) for a tandem with "How far? Friends of friends" and
 * gets Mira's line (a friend of Jakob's who allowed it in advance) marked "through Jakob"; with "My contacts" nothing comes back.
 * Real phones (headless Chromium, 390x844), the real app, the real relay protocol, the real services/trustweb-peer.
 *
 * Local (default): in-memory RelayServer + Vite (TW_PUBLIC_DIR serves demo-peer.json) + startPeer on the shipped
 * demo_inventory.json in this process. Live: TW_URL=https://app.trustintheweb.org/ (or https://app.idea2.site/trustweb/) uses the
 * deployed app, relay and demo front door; the ask is then also forwarded to the real owner's phone (it holds no tandem line, so it
 * stays silent), so run it sparingly: two asks per run.
 * A throwaway host phone named Jakob (a headless context, gone at the end) makes the demo account "Tess-demo", the guest phone
 * opens it, the host allows it, the guest asks twice. Timing of both answers is printed.
 *
 * Run from apps/demo/ (tsx lives at the repo root node_modules):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> [TW_URL=<app>] [TW_SHOTS=<dir>] ../../node_modules/.bin/tsx ../../services/trustweb-peer/test/friend_tandem_e2e.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from '../../../apps/trustweb/test/e2e/swiss_harness.mjs'
import { startPeer, PeerPolicy } from '../peer.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INVENTORY = path.resolve(HERE, '../demo_inventory.json')
const LIVE = process.env.TW_URL
const SHOTS = process.env.TW_SHOTS
const PORT = Number(process.env.TW_PORT || 8996)
const VIEWPORT = { width: 390, height: 844 }
const TANDEM = 'Tandem bicycle to lend, weekends (two seats, Vienna)'
const GUEST = 'Tess'
const c = checker()
const ok = c.ok
const errors = []

const label = LIVE ? new URL(LIVE).hostname + (new URL(LIVE).pathname.length > 1 ? new URL(LIVE).pathname.replace(/\/$/, '').replace(/\//g, '_') : '') : 'local'
const shot = async (page, what) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `6d_${label}_${what}.png`) }) }
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')

async function makeDemoAccount(host, first) {
  await host.getByRole('button', { name: /Show my code/ }).click()
  await host.getByRole('tab', { name: 'Demo account' }).waitFor({ timeout: 10_000 })
  await host.getByRole('tab', { name: 'Demo account' }).click()
  const field = host.getByLabel('Name of the demo account')
  await host.waitForTimeout(500)
  await field.focus()
  await host.waitForTimeout(50)
  await host.keyboard.type(first)
  await host.getByRole('button', { name: 'Make the demo account' }).click()
  await host.getByRole('heading', { name: `${first}-demo is ready` }).waitFor({ timeout: 10_000 })
  await host.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return host.getAttribute('.qrwrap', 'data-payload')
}

/** Asks `question` in the guest's dock with the "How far?" choice; resolves with the result card text and the time it took. */
async function ask(guest, question, reachChoice) {
  await guest.locator('nav.tabs button', { hasText: 'Web' }).click()
  if (await guest.locator('.query-dock').count() === 0) await guest.getByRole('button', { name: 'Call into your web', exact: true }).click()
  await guest.locator('.query-dock').waitFor({ timeout: 10_000 })
  await guest.locator(`.query-dock [data-reach-choice="${reachChoice}"]`).click()
  await guest.locator('.query-dock textarea').fill(question)
  await shot(guest, `dock_${reachChoice}`)
  const t0 = Date.now()
  await guest.getByRole('button', { name: 'Call into my web' }).click()
  await guest.locator('.card.asked .outcome').first().waitFor({ timeout: 240_000 })
  const ms = Date.now() - t0
  // The card settles when the last asked person has answered; give a late sibling answer a moment, then read the whole card.
  await guest.waitForTimeout(1500)
  const card = await text(guest.locator('.card.asked').first())
  await guest.locator('.card.asked').first().scrollIntoViewIfNeeded()
  await shot(guest, `answer_${reachChoice}`)
  return { card, ms }
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const scratch = mkdtempSync(path.join(tmpdir(), 'tw-6d-'))
  const publicDir = path.join(scratch, 'public')
  mkdirSync(publicDir)
  let relay = null
  let vite = null
  let peer = null
  const peerLog = []
  let base = LIVE
  if (!LIVE) {
    relay = await startRelay()
    peer = await startPeer({ stateDir: path.join(scratch, 'peer'), inventoryFile: INVENTORY, relayOrigin: `http://127.0.0.1:${relay.port}`, policy: PeerPolicy.Open, healthPort: 0, log: (l) => peerLog.push(l) })
    writeFileSync(path.join(publicDir, 'demo-peer.json'), JSON.stringify(peer.card))
    vite = await startVite(PORT, { relayPort: relay.port, publicDir })
    base = vite.base
  }
  console.log('trustweb 6d: a friend of Jakob answered through his front door, against ' + base)
  const browser = await launch()
  try {
    const host = await newPhone(browser, errors, { viewport: VIEWPORT })
    const guest = await newPhone(browser, errors, { viewport: VIEWPORT })
    await startPhone(host, base, 'Jakob')
    await host.locator('.demo-friends').getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
    const link = await makeDemoAccount(host, GUEST)
    ok('the demo code names the demo front door too', /&p=did%3Apeer/.test(link) && /&pn=Jakob(&|$)/.test(link), link)

    await guest.goto(link)
    await guest.getByRole('button', { name: `Start as ${GUEST}-demo` }).click()
    await guest.locator('.query-dock').waitFor({ timeout: 20_000 })
    await guest.locator('.node:not(.you)', { hasText: 'Jakob' }).first().waitFor({ timeout: 20_000 })
    for (let i = 0; i < 100 && (await record(guest)).peers.length < 2; i++) await guest.waitForTimeout(100)
    await host.getByRole('button', { name: 'Back' }).click().catch(() => {})
    const card = host.locator('.demo-friends')
    await card.waitFor({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Allow', exact: true }).click()
    await guest.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
    const g = await record(guest)
    ok(`${GUEST}-demo is connected to Jakob and to his front door, shown as one Jakob`, g.peers.length === 2 && g.people.filter((p) => p.name === 'Jakob').length === 1)
    await shot(guest, 'connected')

    // 1. Friends of friends: Mira's tandem, through Jakob
    const fofAsk = await ask(guest, 'Does anyone have a tandem I could borrow for the weekend?', 'fof')
    console.log(`  [t] friends of friends: answered after ${fofAsk.ms} ms`)
    console.log('  [card] ' + fofAsk.card.slice(0, 400))
    ok('Friends of friends: the tandem line comes back', fofAsk.card.includes(TANDEM), fofAsk.card)
    ok('it is marked "through Jakob" and the card says Jakob passed it on', /through Jakob/.test(fofAsk.card) && /Jakob passed this on/.test(fofAsk.card), fofAsk.card)
    ok('Mira is named as the friend who allowed it in advance', /Mira, a friend of Jakob\. Allowed in advance by Mira \(2026-10-08\)/.test(fofAsk.card), fofAsk.card)
    ok('it comes at the travelling moment (two answer windows, 60 s or more), not at the one-window moment of a direct answer', fofAsk.ms >= 55_000, String(fofAsk.ms))
    const kept = (await record(guest)).found?.[0]?.shared ?? []
    ok('"What this account found" keeps the line with its "through" mark', JSON.stringify(kept.flatMap((s) => s.items).find((i) => i.text === TANDEM)?.via) === '["Jakob"]', JSON.stringify(kept))

    // 2. My contacts (the default): nothing
    const contactsAsk = await ask(guest, 'And a tandem, just from my contacts?', 'contacts')
    console.log(`  [t] my contacts: answered after ${contactsAsk.ms} ms`)
    ok('My contacts: no tandem, no Mira', !contactsAsk.card.includes(TANDEM) && !/Mira/.test(contactsAsk.card), contactsAsk.card)
    ok('it is answered at the one-window moment (about 30 s to 45 s with the owner awaited), earlier than the travelling answer', contactsAsk.ms < fofAsk.ms, `${contactsAsk.ms} vs ${fofAsk.ms}`)

    if (peer) {
      ok('the local peer logged outcomes only, never the ask, the line or a name', !peerLog.some((l) => /tandem|mira|bicycle|vienna|weekend|tess/i.test(l)) && peerLog.some((l) => /friend=1/.test(l)), peerLog.slice(-6).join(' | '))
    } else {
      console.log('  NOTE  live: the peer log is the journal on questhub (journalctl -u trustweb-peer); check it by hand')
    }
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    await peer?.stop()
    vite?.stop()
    await relay?.stop()
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
