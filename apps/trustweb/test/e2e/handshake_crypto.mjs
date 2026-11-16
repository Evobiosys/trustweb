// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto: the connect handshake is sealed with the QR key. Three phones (360x780, TW_WIDE=1 -> 1280x900), a real
 * RelayServer behind the Vite /relay proxy whose queue store this suite reads (and, on request, damages), stock data only:
 *   1. Bertram opens Annika's code: both hold each other; every wire the relay stored for Annika is ciphertext (no name, no id, no
 *      cleartext connect-ack).
 *   2. Settings shows "Handshake: encrypted with the QR key (v2)".
 *   3. Cosima's sealed connect-ack is damaged on the relay: Annika shows "Connection not secure, try the QR again", adds nobody.
 *   4. Cosima opens Annika's link without its key (an app before v2): "Update the app on both phones", nothing added, nothing sent.
 * Run from apps/demo (PORT 5441):
 *   PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=5441 ../../node_modules/.bin/tsx ../trustweb/test/e2e/handshake_crypto.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'
import { plainHits, wireKind } from '../helpers/relay_plain.mjs'

const PORT = Number(process.env.TW_PORT || 5441)
const SHOTS = process.env.TW_SHOTS
const VIEW = process.env.TW_WIDE ? { width: 1280, height: 900 } : { width: 360, height: 780 }
const c = checker()
const ok = c.ok
const errors = []
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `handshake-crypto-${name}-${VIEW.width}.png`) }) }
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()

/** startRelay of swiss_harness.mjs, plus: every stored wire is tapped, and the next sealed connect-ack to `damage.to` gets one byte flipped. */
async function startRelay(vitePort, tap, damage) {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const store = new InMemoryRelayQueueStore()
  const enqueue = store.enqueue.bind(store)
  store.enqueue = (to, wire) => {
    if (damage.to === to) {
      const outer = JSON.parse(wire)
      const inner = (() => { try { return JSON.parse(outer.payload) } catch { return null } })()
      if (inner && inner.t === 'connect-ack2') { // every one while on: a re-sent (genuine) ack must not slip through mid-test
        inner.c = inner.c.slice(0, 8) + (inner.c[8] === 'A' ? 'B' : 'A') + inner.c.slice(9)
        wire = JSON.stringify({ ...outer, payload: JSON.stringify(inner) })
        damage.done = true
      }
    }
    tap.push({ to, wire })
    return enqueue(to, wire)
  }
  const relay = new RelayServer({ queueStore: store, senderAuthAudiences: [`http://127.0.0.1:${vitePort}`] })
  const { port } = await relay.listen(0, '127.0.0.1')
  return { port, stop: () => relay.close?.() }
}

async function showCode(page, base) {
  await tab(page, 'Web')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = (await page.getAttribute('.qrwrap', 'data-payload')).replace(/^https?:\/\/[^/]+\//, base)
  await page.getByRole('button', { name: 'Back' }).click().catch(() => {})
  if (!url.startsWith(base)) throw new Error('not a local link: ' + url.slice(0, 40))
  return url
}

const peersOf = async (page) => (await record(page)).peers ?? []
const noticeText = (page) => page.locator('body').innerText().catch(() => '')

async function main() {
  const tap = []
  const damage = { to: null, done: false }
  const vite0 = PORT
  const relay = await startRelay(vite0, tap, damage)
  const vite = await startVite(PORT, { relayPort: relay.port })
  console.log(`handshake-crypto against ${vite.base} at ${VIEW.width}x${VIEW.height}`)
  const browser = await launch()
  try {
    const ann = await newPhone(browser, errors, { viewport: VIEW })
    const ber = await newPhone(browser, errors, { viewport: VIEW })
    const cos = await newPhone(browser, errors, { viewport: VIEW })
    for (const p of [ann, ber, cos]) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(ann, vite.base, 'Annika')
    await startPhone(ber, vite.base, 'Bertram')
    await startPhone(cos, vite.base, 'Cosima')
    const annDid = (await record(ann)).identity?.did

    // 1. QR connect, sealed
    const url = await showCode(ann, vite.base)
    ok('1. the code carries the QR key (k=, 22 characters)', /^[A-Za-z0-9_-]{22}$/.test(new URL(url).searchParams.get('k') ?? ''), url.slice(0, 60))
    await ber.goto(url)
    await acceptAdd(ber)
    const got = await until(async () => (await peersOf(ann)).find((p) => p.displayName === 'Bertram'))
    ok('1. Annika holds Bertram, handshake qr', got?.handshake === 'qr', JSON.stringify(got ?? null).slice(0, 120))
    ok('1. Bertram holds Annika, handshake qr', (await peersOf(ber)).some((p) => p.did === annDid && p.handshake === 'qr'))
    const berId = (await record(ber)).me.id
    const toAnn = tap.filter((w) => w.to === annDid)
    const hits = toAnn.map((w) => plainHits(w.wire, ['Bertram', berId])).filter((h) => h.length)
    ok(`1. relay store: ${toAnn.length} wires to Annika, none readable (no name, no id)`, toAnn.length > 0 && hits.length === 0, JSON.stringify(hits.slice(0, 2)))
    ok('1. no cleartext connect-ack anywhere in the relay store', tap.every((w) => wireKind(w.wire) !== 'connect-ack'))
    ok('1. the sealed connect-ack is on the relay', toAnn.some((w) => w.wire.includes('connect-ack2')))
    await shot(ber, 'connected')

    // 2. Settings line
    await ann.locator('.hdr [aria-label="Settings"]').click()
    await ann.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
    const line = ann.locator('[data-handshake-line]')
    ok('2. Settings: "Handshake: encrypted with the QR key (v2)"', (await line.innerText().catch(() => '')) === 'Handshake: encrypted with the QR key (v2)')
    await line.scrollIntoViewIfNeeded().catch(() => {})
    await shot(ann, 'settings')
    await ann.locator('.sheet.on .sheet-home').click().catch(() => {})

    // 3. damaged on the relay
    damage.to = annDid
    await cos.goto(url)
    await acceptAdd(cos).catch(() => {})
    await until(async () => damage.done, 15_000)
    ok('3. the relay damaged one sealed connect-ack', damage.done)
    const said = await until(async () => /Connection not secure, try the QR again\./.test(await noticeText(ann)), 20_000)
    ok('3. Annika: "Connection not secure, try the QR again."', !!said, (await noticeText(ann)).slice(0, 120))
    ok('3. Annika added nobody', !(await peersOf(ann)).some((p) => p.displayName === 'Cosima'))
    const log = (await record(ann)).handshakeLog ?? []
    ok('3. the record logs it (tampered, a DID fingerprint, no name)', log[0]?.reason === 'tampered' && !JSON.stringify(log).includes('Cosima'), JSON.stringify(log))
    await shot(ann, 'not-secure')
    damage.to = null

    // 4. a link without its key (an app before v2)
    const cos2 = await newPhone(browser, errors, { viewport: VIEW })
    // review-44: the dev overlays hidden here too (the 360 run failed: the dev "Personal preview" header lay over Start on this phone)
    await cos2.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
    await startPhone(cos2, vite.base, 'Cora')
    const before = tap.length
    const old = new URL(url); old.searchParams.delete('k')
    cos2.on('console', (m) => { if (process.env.TW_DEBUG) console.log('  [cos2]', m.text().slice(0, 200)) })
    await cos2.goto(old.toString())
    // the notice fades after a while: watch for it while the add sheet (if it shows) is answered
    const toldP = until(async () => /Update the app on both phones/.test(await noticeText(cos2)), 30_000)
    await cos2.locator('.sheet.on [data-connect-add]').click({ timeout: 8_000 }).catch(() => {})
    const told = await toldP
    ok('4. the scanner: "Update the app on both phones"', !!told, (await noticeText(cos2)).slice(0, 120))
    ok('4. nothing added on the scanner', (await peersOf(cos2)).length === 0)
    ok('4. nothing sent to Annika', tap.slice(before).every((w) => w.to !== annDid))
    await shot(cos2, 'old-code')

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
