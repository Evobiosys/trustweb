/**
 * Demo (test) accounts from the QR button (owner, Omi walk 2026-10-06), end
 * to end in headless Chromium over a real relay:
 *
 *   1. Jakob's phone: QR > Demo account > "Anna" makes "Anna-test"; the code's
 *      link carries the account name in the fragment, no server sees it.
 *   2. Anna's phone opens it: no name to type, "Start as Anna-test", connected,
 *      the ask is open right away, no demo-content card.
 *   3. Jakob's phone lists the account (Settings > Demo accounts, connected).
 *   4. Anna asks; Jakob gets the usual consent prompt and shares; Anna sees it.
 *      Nothing changes in the gate: consent per ask stays.
 *   5. Jakob removes the account: the peer and the person are gone, and a new
 *      ask from that phone reaches nothing (no prompt, no log line).
 *   6. With the demo inventory peer published (demo-peer.json next to the app,
 *      services/trustweb-peer), a second account "Ben-test" is connected to
 *      Jakob AND the demo inventory; the peer answers a motorbike ask on its
 *      own after the 30 s window, and never logs the ask's text.
 *
 * Local (default): RelayServer + Vite (TW_PUBLIC_DIR serves the card) + the peer
 * in this process. Live: TW_URL=https://app.idea2.site/trustweb/ runs steps 1-5
 * against the deployed app and its relay; step 6 runs only where the live site
 * publishes demo-peer.json (it does not until the peer service is deployed).
 * TW_SHOTS=<dir> saves screenshots.
 *
 * Run from apps/demo/ (it has tsx and the toolchain):
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/demo_account.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const REPO = path.resolve(TW_ROOT, '../..')
const PORT = Number(process.env.TW_PORT || 5196)
const LIVE = process.env.TW_URL
const SHOTS = process.env.TW_SHOTS

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }) }
const stored = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('trustweb.v1.me')))

async function main() {
  const { startPeer, PeerPolicy } = await import('../../../../services/trustweb-peer/peer.ts')
  let relay = null
  let relayPort = 0
  if (!LIVE) {
    const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    relayPort = (await relay.listen(0, '127.0.0.1')).port
  }
  const scratch = mkdtempSync(path.join(tmpdir(), 'tw-demo-acct-'))
  const publicDir = path.join(scratch, 'public')
  mkdirSync(publicDir)
  const base = LIVE || `http://127.0.0.1:${PORT}/`
  // Vite reads its public directory at start, so the second phase (the card
  // published next to the app) restarts it with demo-peer.json in place.
  const startVite = async () => {
    const proc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
      cwd: TW_ROOT,
      env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}`, TW_PUBLIC_DIR: publicDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForServer(base)
    return proc
  }
  const stopVite = (proc) => new Promise((resolve) => { proc.once('exit', resolve); proc.kill('SIGTERM') })
  let viteProc = LIVE ? null : await startVite()
  console.log('trustweb demo accounts against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  let peer = null
  try {
    browser = await engine.launch({ headless: true })
    const errors = []
    const mk = async () => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const p = await c.newPage()
      p.on('pageerror', (e) => errors.push(e.message))
      return p
    }

    // 1. Jakob makes "Anna-test"
    const a = await mk()
    await a.goto(base)
    await a.getByLabel('Your first name').fill('Jakob')
    await a.getByRole('button', { name: 'Start on this phone' }).click()
    await a.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await a.locator('.demo-friends').getByRole('button', { name: 'No thanks' }).click()
    await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await a.getByPlaceholder('e.g. Motorbike, can lend it for a weekend').fill('Ladder, can lend it for a weekend')
    await a.getByRole('button', { name: 'Add', exact: true }).click()
    ok('Jakob has one inventory line', (await a.locator('.inv').count()) === 1)
    await a.getByRole('button', { name: /Show my code/ }).click()
    await a.getByRole('tab', { name: 'Demo account' }).waitFor({ timeout: 10_000 })
    ok('Meet offers a "Demo account" page next to the codes', true)
    await a.getByRole('tab', { name: 'Demo account' }).click()
    ok('it explains itself (ask your web as if connected, you still say yes or no)', /as if they were connected/.test(await a.locator('.demo-acct').innerText()) && /yes or no/.test(await a.locator('.demo-acct').innerText()))
    ok('no accounts yet', /None yet/.test(await a.locator('.demo-acct').innerText()))
    await shot(a, '01-jakob-demo-account-form')
    await a.getByPlaceholder('Their first name').fill('Anna')
    await a.getByRole('button', { name: 'Make the test account' }).click()
    await a.getByRole('heading', { name: 'Anna-test is ready' }).waitFor({ timeout: 10_000 })
    await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const link = await a.getAttribute('.qrwrap', 'data-payload')
    ok('the code is a connect link with the account name in the fragment', /\?connect=did%3Apeer/.test(link) && /#t=Anna-test$/.test(link), link)
    ok('without the peer published, the card says you alone decide', /You, and you decide each time/.test(await a.locator('.qr-facts').innerText()))
    ok('the account is listed as not opened yet', /not opened yet/.test(await a.locator('.test-row').innerText()))
    await shot(a, '02-jakob-anna-test-code')
    const aState = await stored(a)
    ok('the account is stored on the phone, without a peer yet', aState.testAccounts?.length === 1 && aState.testAccounts[0].name === 'Anna-test' && !aState.testAccounts[0].peerId)

    // 2. Anna opens it
    const b = await mk()
    await b.goto(link)
    const invite = b.locator('.test-invite')
    await invite.waitFor({ timeout: 10_000 })
    ok('Anna sees "Jakob made a test account for you."', /Jakob made a test account for you\./.test(await invite.innerText()))
    ok('the name is set, nothing to type', (await b.locator('.test-name').innerText()) === 'Anna-test' && (await b.locator('input.field').count()) === 0)
    await shot(b, '03-anna-invite')
    await b.getByRole('button', { name: 'Start as Anna-test' }).click()
    await b.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await b.locator('.query-dock').waitFor({ timeout: 20_000 })
    ok('Anna lands with the ask open', true)
    await b.locator('.toast.on').waitFor({ timeout: 20_000 })
    ok('Anna: "Connected with Jakob. Ask away."', /Connected with Jakob\. Ask away\./.test(await b.locator('.toast').innerText()), await b.locator('.toast').innerText())
    ok('no demo-content card over a test account', await b.locator('.demo-friends').isHidden())
    const bState = await stored(b)
    ok('Anna\'s phone knows it is Jakob\'s test account', bState.me.displayName === 'Anna-test' && bState.testOf?.name === 'Jakob' && bState.peers.length === 1)
    await shot(b, '04-anna-connected-ask-open')

    // 3. Jakob's side
    await a.locator('.toast.on').waitFor({ timeout: 20_000 })
    ok('Jakob: "Connected with Anna-test, as an acquaintance."', /Connected with Anna-test, as an acquaintance\./.test(await a.locator('.toast').innerText()), await a.locator('.toast').innerText())
    await a.waitForTimeout(300)
    ok('the code page now says connected', /connected/.test(await a.locator('.test-row').innerText()))
    await a.getByRole('button', { name: 'Back' }).click()
    await a.locator('nav.tabs button', { hasText: 'Web' }).click()
    ok('Anna-test sits on Jakob\'s web', (await a.locator('.node', { hasText: 'Anna-test' }).count()) === 1)
    await a.locator('.node', { hasText: 'Anna-test' }).click()
    ok('her card says it is a demo account he made', /Demo account you made/.test(await a.locator('.sheet').innerText()))
    await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await a.getByRole('button', { name: 'More' }).click()
    await a.locator('.menu-item', { hasText: 'Settings' }).click()
    const settings = await a.locator('.sheet').innerText()
    ok('Settings > Demo accounts lists Anna-test as connected', /Demo accounts/i.test(settings) && /Anna-test/.test(settings) && /connected/.test(settings))
    await shot(a, '05-jakob-settings-demo-accounts')
    await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // 4. Anna asks, Jakob consents
    await b.locator('.query-dock textarea').fill('Does anyone have a ladder I could borrow?')
    await b.getByRole('button', { name: 'Ask my web' }).click()
    await a.locator('.overlay.on').waitFor({ timeout: 20_000 })
    ok('Jakob gets the usual consent prompt from Anna-test', /Anna-test asks/.test(await a.locator('.overlay').innerText()) && /Ladder/.test(await a.locator('.overlay').innerText()))
    await shot(a, '06-jakob-consent-prompt')
    await a.getByRole('button', { name: 'Share these' }).click()
    await b.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    const outcome = await b.locator('.card.asked .outcome').innerText()
    ok('Anna sees what Jakob shared, after the window', /Jakob chose to share/.test(outcome) && /Ladder/.test(outcome), outcome)
    await shot(b, '07-anna-answer')
    await a.getByRole('button', { name: 'Back to the app' }).click()

    // 5. Jakob removes the account
    await a.getByRole('button', { name: 'More' }).click()
    await a.locator('.menu-item', { hasText: 'Settings' }).click()
    await a.getByRole('button', { name: 'Remove Anna-test' }).click()
    await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const after = await stored(a)
    ok('removing forgets the peer, the person and the account', after.peers.length === 0 && !after.people.some((p) => p.name === 'Anna-test') && after.testAccounts === undefined)
    ok('Anna-test is off the web', (await a.locator('.node', { hasText: 'Anna-test' }).count()) === 0)
    const logBefore = after.log.length
    await b.getByRole('button', { name: /Ask something else|Close/ }).first().click().catch(() => {})
    await b.getByRole('button', { name: 'Call into your web' }).click().catch(() => {})
    await b.locator('.query-dock textarea').fill('Does anyone have a ladder?')
    await b.getByRole('button', { name: 'Ask my web' }).click()
    await a.waitForTimeout(8_000)
    ok('a new ask from the removed phone reaches nothing on Jakob\'s side', (await a.locator('.overlay.on').count()) === 0 && (await stored(a)).log.length === logBefore)

    // 6. The demo inventory peer, published next to the app (local only until the service is deployed)
    const livePeer = LIVE ? await fetch(base + 'demo-peer.json', { cache: 'no-store' }).then((r) => r.ok && /json/.test(r.headers.get('content-type') ?? '')).catch(() => false) : false
    if (LIVE && !livePeer) {
      console.log('  SKIP  live site publishes no demo-peer.json yet: the peer steps run locally only')
      ok('no page errors', errors.length === 0, JSON.stringify(errors))
      return
    }
    const peerLog = []
    peer = await startPeer({
      stateDir: path.join(scratch, 'peer'), inventoryFile: path.join(REPO, 'services/trustweb-peer/demo_inventory.json'),
      relayOrigin: `http://127.0.0.1:${relayPort}`, policy: PeerPolicy.Open, healthPort: 0, log: (l) => peerLog.push(l),
    })
    writeFileSync(path.join(publicDir, 'demo-peer.json'), JSON.stringify(peer.card))
    await stopVite(viteProc)
    viteProc = await startVite()
    ok('the card is served next to the app', (await (await fetch(base + 'demo-peer.json')).json()).did === peer.card.did)
    await a.reload()
    await a.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await a.getByRole('button', { name: /Show my code/ }).click()
    await a.getByRole('tab', { name: 'Demo account' }).click()
    await a.getByPlaceholder('Their first name').fill('Ben')
    await a.getByRole('button', { name: 'Make the test account' }).click()
    await a.getByRole('heading', { name: 'Ben-test is ready' }).waitFor({ timeout: 10_000 })
    await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const link2 = await a.getAttribute('.qrwrap', 'data-payload')
    ok('with the peer published, the code names it in the fragment too', /#t=Ben-test&p=did%3Apeer/.test(link2) && /&pn=Demo\+inventory/.test(link2), link2)
    ok('the card says Jakob and the demo inventory can be asked', /and Demo inventory/.test(await a.locator('.qr-facts').innerText()))
    await shot(a, '08-jakob-ben-test-code-with-peer')
    const b2 = await mk()
    await b2.goto(link2)
    await b2.getByRole('button', { name: 'Start as Ben-test' }).click()
    await b2.locator('.query-dock').waitFor({ timeout: 20_000 })
    await b2.locator('.node', { hasText: 'Demo inventory' }).waitFor({ timeout: 20_000 })
    const nodes = await b2.locator('.node:not(.you) span').allInnerTexts()
    ok('Ben-test is connected to Jakob and to the demo inventory', nodes.includes('Jakob') && nodes.includes('Demo inventory'), JSON.stringify(nodes))
    for (let i = 0; i < 50 && peer.peerCount() < 1; i++) await new Promise((r) => setTimeout(r, 100))
    ok('the peer holds Ben-test as its peer', peer.peerCount() === 1)
    await shot(b2, '09-ben-connected-two-peers')
    await b2.locator('.query-dock textarea').fill('Does anyone have a motorbike I could borrow?')
    await b2.getByRole('button', { name: 'Ask my web' }).click()
    // Jakob's phone has no motorbike: it stays silent; the peer answers alone.
    await b2.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    const outcome2 = await b2.locator('.card.asked .outcome').innerText()
    ok('the demo inventory answers by itself after the window', /Demo inventory chose to share/.test(outcome2) && /Motorbike/.test(outcome2), outcome2)
    ok('Jakob was not prompted (nothing of his matched)', (await a.locator('.overlay.on').count()) === 0)
    ok('the peer logged the outcome, never the ask', peerLog.some((l) => /ask shared/.test(l)) && !peerLog.some((l) => /motorbike/i.test(l)))
    await shot(b2, '10-ben-answer-from-peer')
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await peer?.stop()
    await browser?.close()
    if (viteProc) await stopVite(viteProc)
    await relay?.close()
    rmSync(scratch, { recursive: true, force: true })
    console.log(failures ? `\n${failures} FAILED` : '\nall passed')
    process.exit(failures ? 1 : 0)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
