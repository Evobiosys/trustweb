/**
 * Demo accounts from the QR button (owner, Omi walk 2026-10-06 and his 09:29
 * spec), end to end in headless Chromium over a real relay:
 *
 *   1. Jakob's phone: QR > Demo account. The name field reads "-demo" with the
 *      caret in front, typing "Anna" gives "Anna-demo"; the code's link carries
 *      the account, its id and its end (a week) in the fragment, no server sees it.
 *   2. Anna's phone opens it: nothing to type, "Start as Anna-demo", then it
 *      WAITS: the ask is closed until Jakob allows the connection in his own view.
 *   3. Jakob: "Anna-demo asks to connect" card, also under Inventory > Review /
 *      requests; nothing is stored until he allows; Allow connects it.
 *   4. Anna asks; Jakob gets the usual consent prompt and shares; Anna sees it;
 *      the ask shows in Review / requests with a "demo" chip. Consent per ask stays.
 *   5. Countdown "7 days left"; Extend a week -> 14 days; End now -> the peer and
 *      the person are gone, a new ask from that phone reaches nothing.
 *   6. On this phone: "Open it on this phone" runs the account in a second tab
 *      (own persona), Jakob allows it, it asks and finds; "Hand over this demo
 *      account" packs it (backup server) into a link; another phone takes it
 *      over with what was found and asks on as that account; the old tab is done.
 *   7. With the demo inventory peer published (demo-peer.json next to the app,
 *      services/trustweb-peer), an account is connected to Jakob AND the demo
 *      inventory; the peer answers a motorbike ask by itself after the window
 *      and never logs the ask's text.
 *
 * Local (default): RelayServer + Vite (TW_PUBLIC_DIR serves the card, /backup
 * proxied to a real backup server) + the peer in this process. Live:
 * TW_URL=https://app.idea2.site/trustweb/ runs steps 1-5 and 6 against the
 * deployed app, its relay and its backup server; step 7 runs only where the
 * live site publishes demo-peer.json (since 2026-10-06 it does: the demo peer on questhub, so step 7 asks that
 * real service; start it only while NO claim window is open or the test phone becomes the owner).
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
const BACKUP_SERVER = path.resolve(REPO, 'services/trustweb-backup/server.mjs')
const PORT = Number(process.env.TW_PORT || 5196)
const BACKUP_PORT = Number(process.env.TW_BACKUP_PORT || 8968)
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
    try { await fetch(url); return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }) }
const stored = async (page, key = 'trustweb.v1.me') => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), key))
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')

async function main() {
  const { startPeer, PeerPolicy } = await import('../../../../services/trustweb-peer/peer.ts')
  let relay = null
  let relayPort = 0
  let backupProc = null
  const scratch = mkdtempSync(path.join(tmpdir(), 'tw-demo-acct-'))
  const publicDir = path.join(scratch, 'public')
  mkdirSync(publicDir)
  if (!LIVE) {
    const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    relayPort = (await relay.listen(0, '127.0.0.1')).port
    backupProc = spawn(process.execPath, [BACKUP_SERVER], {
      env: { ...process.env, BACKUP_DIR: path.join(scratch, 'backup'), PORT: String(BACKUP_PORT), HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForServer(`http://127.0.0.1:${BACKUP_PORT}/`)
  }
  const base = LIVE || `http://127.0.0.1:${PORT}/`
  // Vite reads its public directory at start, so the peer phase (the card
  // published next to the app) restarts it with demo-peer.json in place.
  const startVite = async () => {
    const proc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
      cwd: TW_ROOT,
      env: {
        ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}`,
        TW_BACKUP_PROXY: `http://127.0.0.1:${BACKUP_PORT}`, TW_PUBLIC_DIR: publicDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForServer(base)
    return proc
  }
  const stopVite = (proc) => new Promise((resolve) => { proc.once('exit', resolve); proc.kill('SIGTERM') })
  let viteProc = LIVE ? null : await startVite()
  console.log('trustweb demo accounts against ' + base)
  // Live, the demo peer's card is published from the start: every demo code then names it in the fragment and a demo phone has two peers.
  const cardAtStart = LIVE ? await fetch(base + 'demo-peer.json', { cache: 'no-store' }).then((r) => r.ok && /json/.test(r.headers.get('content-type') ?? '')).catch(() => false) : false
  const demoPeers = cardAtStart ? 2 : 1

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  let peer = null
  try {
    // A fake microphone for the meeting Jakob records and sends inside TrustWeb (step 4b).
    browser = await engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    const errors = []
    const mk = async () => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] })
      const p = await c.newPage()
      p.on('pageerror', (e) => errors.push(e.message))
      return p
    }
    const openDemoTab = async (page) => {
      await page.getByRole('button', { name: /Show my code/ }).click()
      await page.getByRole('tab', { name: 'Demo account' }).waitFor({ timeout: 10_000 })
      await page.getByRole('tab', { name: 'Demo account' }).click()
    }
    const makeAccount = async (page, first) => {
      const field = page.getByLabel('Name of the demo account')
      await page.waitForTimeout(500)
      await field.focus()
      await page.waitForTimeout(50)
      await page.keyboard.type(first)
      await page.getByRole('button', { name: 'Make the demo account' }).click()
      await page.getByRole('heading', { name: `${first}-demo is ready` }).waitFor({ timeout: 10_000 })
      await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
      return page.getAttribute('.qrwrap', 'data-payload')
    }
    const allowOn = async (page, name, where) => {
      if (where === 'card') {
        const card = page.locator('.demo-friends')
        await card.waitFor({ timeout: 20_000 })
        ok(`Jakob sees "${name} asks to connect" in his own view`, new RegExp(`${name} asks to connect`).test(await card.innerText()))
        await card.getByRole('button', { name: 'Allow', exact: true }).click()
      } else {
        await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
        await page.getByRole('button', { name: 'Review requests' }).click()
        const sheet = page.locator('.sheet')
        await sheet.getByRole('button', { name: `Allow ${name}` }).waitFor({ timeout: 20_000 })
        ok('the request also shows under Inventory > Review / requests', new RegExp(`${name}.*asks to connect`).test(await text(sheet)))
        await sheet.getByRole('button', { name: `Allow ${name}` }).click()
        await page.locator('.toast.on', { hasText: 'Allowed' }).waitFor({ timeout: 20_000 })
        await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
      }
      await page.locator('.toast.on').waitFor({ timeout: 10_000 })
    }

    // 1. Jakob makes "Anna-demo"
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
    await openDemoTab(a)
    ok('Meet offers a "Demo account" page next to the codes', true)
    const field = a.getByLabel('Name of the demo account')
    await a.waitForTimeout(500)
    ok('the name field reads "-demo" with the caret in front of it', (await field.inputValue()) === '-demo' && (await field.evaluate((e) => e.selectionStart)) === 0)
    ok('it explains itself (allow first, yes or no each time, a week)', /allow the connection first/.test(await text(a.locator('.demo-acct'))) && /after a week/.test(await text(a.locator('.demo-acct'))))
    await shot(a, '01-jakob-demo-account-form')
    await a.keyboard.type('Anna')
    ok('typing gives "Anna-demo"', (await field.inputValue()) === 'Anna-demo')
    await field.press('End')
    for (let i = 0; i < 5; i++) await field.press('Backspace')
    ok('the suffix can be erased', (await field.inputValue()) === 'Anna')
    await a.keyboard.type('-demo')
    await a.getByRole('button', { name: 'Make the demo account' }).click()
    await a.getByRole('heading', { name: 'Anna-demo is ready' }).waitFor({ timeout: 10_000 })
    await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const link = await a.getAttribute('.qrwrap', 'data-payload')
    ok('the code is a connect link with account, id and end in the fragment', /\?connect=did%3Apeer/.test(link) && /#t=Anna-demo&a=[A-Za-z0-9_-]{8}&x=\d{13}(&p=did%3Apeer[^&]+&pi=[^&]+&pn=[^&]+)?$/.test(link), link)
    const facts = await text(a.locator('.qr-facts'))
    ok('the card says you allow it first and it ends in 7 days', /once you allow it/.test(facts) && /Ends in 7 days/.test(facts), facts)
    ok('the row counts down: not opened yet, 7 days left', /not opened yet · 7 days left/.test(await text(a.locator('.test-card'))))
    await shot(a, '02-jakob-anna-demo-code')
    const aState = await stored(a)
    ok('the account is stored with its end, without a peer', aState.testAccounts?.length === 1 && aState.testAccounts[0].name === 'Anna-demo' && !aState.testAccounts[0].peerId && aState.testAccounts[0].expiresAt > Date.now() + 6.9 * 86_400_000)

    // 2. Anna opens it and waits
    const b = await mk()
    await b.goto(link)
    const invite = b.locator('.test-invite')
    await invite.waitFor({ timeout: 10_000 })
    ok('Anna sees "Jakob made a demo account for you."', /Jakob made a demo account for you\./.test(await invite.innerText()))
    ok('the name is set, nothing to type', (await b.locator('.test-name').innerText()) === 'Anna-demo' && (await b.locator('input.field').count()) === 0)
    await shot(b, '03-anna-invite')
    await b.getByRole('button', { name: 'Start as Anna-demo' }).click()
    await b.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await b.locator('.query-dock').waitFor({ timeout: 20_000 })
    await b.locator('.toast.on').waitFor({ timeout: 20_000 })
    ok('Anna: "Waiting for Jakob to allow this demo account."', /Waiting for Jakob to allow/.test(await b.locator('.toast').innerText()), await b.locator('.toast').innerText())
    ok('the ask is closed until then', await b.getByRole('button', { name: 'Call into my web' }).isDisabled() && /has not allowed this demo account yet/.test(await text(b.locator('.query-dock'))))
    ok('no demo-content card over a demo account', await b.locator('.demo-friends').isHidden())
    await shot(b, '04-anna-waiting')

    // 3. Jakob allows, from Review / requests
    const card = a.locator('.demo-friends')
    await card.waitFor({ timeout: 20_000 })
    ok('Jakob sees "Anna-demo asks to connect" in his own view', /Anna-demo asks to connect/.test(await card.innerText()))
    ok('nothing is stored until he allows (no peer yet)', (await stored(a)).peers.length === 0 && (await stored(a)).testAccounts[0].pending?.displayName === 'Anna-demo')
    await shot(a, '05-jakob-allow-card')
    await a.getByRole('button', { name: 'Back' }).click()
    await allowOn(a, 'Anna-demo', 'requests')
    ok('Jakob: "Allowed. Anna-demo can call into your web now."', /Allowed\. Anna-demo can call into your web now\./.test(await a.locator('.toast').innerText()))
    const afterAllow = await stored(a)
    ok('the peer and the person exist now, the account is connected', afterAllow.peers.length === 1 && afterAllow.people.some((p) => p.name === 'Anna-demo' && p.context === 'Demo account you made') && afterAllow.testAccounts[0].peerId && !afterAllow.testAccounts[0].pending)
    await b.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
    ok('Anna: "Jakob allowed it. Ask away."', true)
    ok('the ask is open now', await b.getByRole('button', { name: 'Call into my web' }).isEnabled())
    const bState = await stored(b)
    ok('Anna\'s phone knows whose demo account it is and when it ends', bState.me.displayName === 'Anna-demo' && bState.testOf?.name === 'Jakob' && bState.testOf.approvedAt && bState.testOf.expiresAt && bState.peers.length === demoPeers)
    await shot(b, '06-anna-allowed-ask-open')

    // 4. Anna asks, Jakob consents, the ask shows under Review / requests
    await b.locator('.query-dock textarea').fill('Does anyone have a ladder I could borrow?')
    await b.getByRole('button', { name: 'Call into my web' }).click()
    await a.locator('.overlay.on').waitFor({ timeout: 20_000 })
    ok('Jakob gets the usual consent prompt from Anna-demo', /Anna-demo asks/.test(await a.locator('.overlay').innerText()) && /Ladder/.test(await a.locator('.overlay').innerText()))
    await shot(a, '07-jakob-consent-prompt')
    await a.getByRole('button', { name: 'Share these' }).click()
    await b.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    const outcome = await b.locator('.card.asked .outcome').innerText()
    ok('Anna sees what Jakob shared, after the window', /Jakob chose to share/.test(outcome) && /Ladder/.test(outcome), outcome)
    await shot(b, '08-anna-answer')
    await a.getByRole('button', { name: 'Back to the app' }).click()
    await a.getByRole('button', { name: 'Review requests' }).click()
    await a.locator('.sheet.on').waitFor({ timeout: 5_000 })
    ok('the ask sits under Review / requests with a "demo" chip', (await a.locator('.sheet .log .demo-chip').count()) === 1 && /Anna-demo:.*demo.*Does anyone have a ladder/i.test(await text(a.locator('.sheet'))), await text(a.locator('.sheet')))
    await shot(a, '09-jakob-requests-demo-chip')
    await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // 4b. Jakob records a short meeting with Anna-demo and sends it to her INSIDE TrustWeb
    // (owner 2026-10-06: pick the recipient from the people already connected; notes and
    // transcript travel encrypted via the backup server, the key only in the link).
    // From Inventory the Record tab opens a meeting straight away (record default by origin, wave 1733).
    await a.locator('nav.tabs .tab-record').click()
    await a.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 10_000 })
    await a.getByLabel('Who are you meeting?').fill('Anna-demo')
    await a.getByLabel('Where are you meeting?').fill('Café Prückel')
    await a.getByRole('switch', { name: /Transcribing/ }).click()
    await a.locator('#consent').check()
    await a.getByRole('button', { name: 'Start recording' }).click()
    await a.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await a.waitForTimeout(1500)
    await a.getByRole('button', { name: 'End meeting' }).click()
    await a.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
    await a.getByRole('button', { name: 'Send inside TrustWeb to...' }).click()
    await a.getByRole('heading', { name: 'Send inside TrustWeb' }).waitFor({ timeout: 5_000 })
    const sendRows = a.locator('.sheet [data-send-to]')
    ok('"Send inside TrustWeb" lists the connected people, Anna-demo with her demo chip', (await sendRows.count()) === 1 && /Anna-demo/.test(await sendRows.first().innerText()) && (await sendRows.first().locator('.demo-chip').count()) === 1)
    await shot(a, '09b-jakob-send-inside-trustweb')
    await sendRows.first().click()
    await a.locator('.toast.on', { hasText: 'Sent to Anna-demo inside TrustWeb' }).waitFor({ timeout: 30_000 })
    ok('Jakob: "Sent to Anna-demo inside TrustWeb."', true)
    const recvCard = b.locator('.demo-friends')
    await recvCard.waitFor({ timeout: 30_000 })
    ok('Anna: "Jakob sent you a meeting" card with Open', /Jakob sent you a meeting/.test(await recvCard.innerText()) && /Meeting with Anna-demo/.test(await recvCard.innerText()), await recvCard.innerText())
    await shot(b, '09c-anna-received-card')
    await recvCard.getByRole('button', { name: 'Open', exact: true }).click()
    await b.locator('.sheet').getByRole('heading', { name: 'From Jakob' }).waitFor({ timeout: 30_000 })
    const packText = await text(b.locator('.sheet'))
    ok('it opens, decrypted on her phone: about, place, notes and transcript sections', /About Anna-demo/.test(packText) && /at Café Prückel/.test(packText) && /notes/i.test(packText) && /transcript/i.test(packText), packText.slice(0, 200))
    await shot(b, '09d-anna-opened-meeting')
    await b.getByRole('button', { name: 'Keep in my past meetings' }).click()
    await b.locator('.toast.on', { hasText: 'Kept' }).waitFor({ timeout: 10_000 })
    const bKept = await stored(b)
    ok('Keep stores it as a past meeting sent by Jakob', bKept.meetings?.length === 1 && bKept.meetings[0].fromName === 'Jakob' && bKept.meetings[0].where === 'Café Prückel' && bKept.received?.length === 1 && Boolean(bKept.received[0].openedAt))
    await b.locator('nav.tabs .tab-record').click()
    await b.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 10_000 })
    ok('Anna\'s Record screen links to Past meetings (1)', /Past meetings \(1\)/.test(await b.locator('.past-link').innerText()))
    await b.locator('nav.tabs button', { hasText: 'Web' }).click()
    await b.locator('.query-dock textarea').waitFor({ timeout: 10_000 })
    // Jakob's own phone kept the meeting too (End meeting wrote it, before any notes)
    const aKept = await stored(a)
    ok('Jakob\'s phone kept the ended meeting with Anna-demo at Café Prückel', aKept.meetings?.length === 1 && aKept.meetings[0].about === 'Anna-demo' && aKept.meetings[0].where === 'Café Prückel' && aKept.meetings[0].meeting === true)
    // A reload drops the in-memory draft (the take is never stored), so the QR button is back for the steps below;
    // the past meeting is in the record and survives.
    await a.reload()
    await a.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('Jakob\'s past meeting survives a reload', (await stored(a)).meetings?.length === 1 && (await a.locator('.status-pill.qr').count()) === 1)
    // Back where step 4 left him (Inventory), so step 5's tab clicks behave as before.
    await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()

    // 5. Countdown, extend, end
    await a.getByRole('button', { name: 'More' }).click().catch(() => {})
    await a.locator('nav.tabs button', { hasText: 'Web' }).click()
    await a.getByRole('button', { name: 'More' }).click()
    await a.locator('.menu-item', { hasText: 'Settings' }).click()
    const settings = a.locator('.sheet')
    ok('Settings > Demo accounts: connected, 7 days left', /DEMO ACCOUNTS/i.test(await text(settings)) && /Anna-demo connected · 7 days left/.test(await text(settings)))
    await settings.getByRole('button', { name: 'Extend a week Anna-demo' }).click()
    ok('Extend a week -> 14 days', /Anna-demo now ends in 14 days\./.test(await a.locator('.toast').innerText()) && /14 days left/.test(await text(a.locator('.sheet'))))
    await shot(a, '10-jakob-settings-demo-accounts')
    await a.locator('.sheet').getByRole('button', { name: 'End now Anna-demo' }).click()
    await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const after = await stored(a)
    ok('End now forgets the peer, the person and the account', after.peers.length === 0 && !after.people.some((p) => p.name === 'Anna-demo') && after.testAccounts === undefined)
    ok('Anna-demo is off the web', (await a.locator('.node', { hasText: 'Anna-demo' }).count()) === 0)
    const logBefore = after.log.length
    await b.getByRole('button', { name: /Call into your web again|Close/ }).first().click().catch(() => {})
    await b.getByRole('button', { name: 'Call into your web' }).click().catch(() => {})
    await b.locator('.query-dock textarea').fill('Does anyone have a ladder?')
    await b.getByRole('button', { name: 'Call into my web' }).click()
    await a.waitForTimeout(8_000)
    ok('a new ask from the ended account reaches nothing on Jakob\'s side', (await a.locator('.overlay.on').count()) === 0 && (await stored(a)).log.length === logBefore)

    // 6. On this phone, then hand it over
    await openDemoTab(a)
    await makeAccount(a, 'Ben')
    const here = a.locator('a.open-here')
    await here.waitFor({ timeout: 10_000 })
    for (let i = 0; i < 50 && (await here.getAttribute('aria-disabled')) === 'true'; i++) await a.waitForTimeout(100)
    const hereHref = await here.getAttribute('href')
    ok('"Open it on this phone" opens the code under its own persona', /[?&]persona=demo-[a-z0-9_-]{8}/.test(hereHref) && /connect=did%3Apeer/.test(hereHref) && /&own=1/.test(hereHref), hereHref)
    const [c] = await Promise.all([a.context().waitForEvent('page'), here.click()])
    c.on('pageerror', (e) => errors.push(e.message))
    // A fresh tab loads the live page over the network: give it the same time as a first visit.
    await c.locator('.test-invite').waitFor({ timeout: 25_000 })
    ok('the second tab says "Your demo account Ben-demo."', /Your demo account Ben-demo\./.test(await c.locator('.test-invite').innerText()))
    await c.getByRole('button', { name: 'Start as Ben-demo' }).click()
    await c.locator('.query-dock').waitFor({ timeout: 20_000 })
    ok('Jakob\'s own record is untouched by the second tab', (await stored(a)).me.displayName === 'Jakob' && (await stored(c)).me.displayName === 'Jakob')
    await a.getByRole('button', { name: 'Back' }).click()
    await allowOn(a, 'Ben-demo', 'card')
    await c.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
    await c.locator('.query-dock textarea').fill('Does anyone have a ladder I could borrow?')
    await c.getByRole('button', { name: 'Call into my web' }).click()
    await a.locator('.overlay.on').waitFor({ timeout: 20_000 })
    await a.getByRole('button', { name: 'Share these' }).click()
    await c.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    ok('the account on this phone asks and gets Jakob\'s share', /Jakob chose to share/.test(await c.locator('.card.asked .outcome').innerText()))
    await a.getByRole('button', { name: 'Back to the app' }).click()
    await c.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    ok('its Inventory shows "What this account found" with the ladder', /What this account found/i.test(await text(c.locator('.found'))) && /Ladder/.test(await text(c.locator('.found'))), await text(c.locator('.found')))
    await shot(c, '11-ben-found')
    await c.getByRole('button', { name: 'Settings' }).click()
    ok('its Settings say it is your demo account and when it ends', /This is your demo account Ben-demo/.test(await text(c.locator('.sheet'))) && /ends in 7 days/.test(await text(c.locator('.sheet'))))
    await c.locator('.sheet').getByRole('button', { name: 'Hand over this demo account' }).click()
    ok('the hand-over sheet explains the pack and the key', /encrypted, on the Swiss server/.test(await text(c.locator('.sheet'))) && /key travels only inside the link/.test(await text(c.locator('.sheet'))))
    await c.locator('.sheet').getByRole('button', { name: 'Make the hand-over link' }).click()
    await c.locator('.sheet .qrwrap canvas').waitFor({ timeout: 30_000 })
    const hand = await c.getAttribute('.sheet .qrwrap', 'data-payload')
    ok('the hand-over link carries the key in the fragment only', /\?handover=1#k=TW1R-[A-Z0-9-]+&a=[A-Za-z0-9]{8}&t=Ben-demo$/.test(hand), hand)
    await shot(c, '12-ben-handover-link')
    await c.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('the old tab is done with the account', /Handed over\./.test(await text(c.locator('.screen'))) && (await stored(c, Object.keys(await c.evaluate(() => ({ ...localStorage }))).find((k) => k.startsWith('trustweb.v1.demo-')))).testOf.handedOverAt > 0)
    const d = await mk()
    await d.goto(hand)
    await d.locator('.test-invite').waitFor({ timeout: 10_000 })
    ok('the other phone: "Ben-demo is handed over to you"', /Ben-demo is handed over to you/.test(await d.locator('.test-invite').innerText()) && /with its connection and what it found/.test(await d.locator('.test-invite').innerText()))
    await shot(d, '13-other-phone-take-over')
    await d.getByRole('button', { name: 'Take over Ben-demo' }).click()
    await d.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 30_000 })
    const dState = await stored(d)
    ok('it took over identity, connection and finds', dState.me.displayName === 'Ben-demo' && dState.peers.length === demoPeers && dState.found?.length === 1 && dState.testOf?.name === 'Jakob' && !dState.testOf.own && !dState.testOf.handedOverAt)
    ok('Jakob is on its web', (await d.locator('.node', { hasText: 'Jakob' }).count()) === 1)
    await d.getByRole('button', { name: 'Call into your web' }).click()
    await d.locator('.query-dock textarea').fill('Anyone with a ladder?')
    await d.getByRole('button', { name: 'Call into my web' }).click()
    await a.locator('.overlay.on').waitFor({ timeout: 20_000 })
    ok('its ask reaches Jakob as Ben-demo, the same connection', /Ben-demo asks/.test(await a.locator('.overlay').innerText()))
    await a.getByRole('button', { name: 'Share these' }).click()
    await d.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    ok('and the answer lands on the new phone', /Jakob chose to share/.test(await d.locator('.card.asked .outcome').innerText()))
    await shot(d, '14-other-phone-asks-on')
    await a.getByRole('button', { name: 'Back to the app' }).click()

    // 7. The demo inventory peer, published next to the app (local only until the service is deployed)
    const livePeer = LIVE ? await fetch(base + 'demo-peer.json', { cache: 'no-store' }).then((r) => r.ok && /json/.test(r.headers.get('content-type') ?? '')).catch(() => false) : false
    if (LIVE && !livePeer) {
      console.log('  SKIP  live site publishes no demo-peer.json yet: the peer steps run locally only')
      ok('no page errors', errors.length === 0, JSON.stringify(errors))
      return
    }
    const peerLog = []
    if (LIVE) {
      // The deployed peer (services/trustweb-peer on questhub): its card is already served; its log is the journal.
      const liveCard = await (await fetch(base + 'demo-peer.json', { cache: 'no-store' })).json()
      ok('the live card names the demo inventory', /^did:peer:/.test(liveCard.did) && liveCard.name === 'Demo inventory', JSON.stringify(liveCard))
    } else {
      peer = await startPeer({
        stateDir: path.join(scratch, 'peer'), inventoryFile: path.join(REPO, 'services/trustweb-peer/demo_inventory.json'),
        relayOrigin: `http://127.0.0.1:${relayPort}`, policy: PeerPolicy.Open, healthPort: 0, log: (l) => peerLog.push(l),
      })
      writeFileSync(path.join(publicDir, 'demo-peer.json'), JSON.stringify(peer.card))
      await stopVite(viteProc)
      viteProc = await startVite()
      ok('the card is served next to the app', (await (await fetch(base + 'demo-peer.json')).json()).did === peer.card.did)
    }
    await a.reload()
    await a.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await openDemoTab(a)
    const link2 = await makeAccount(a, 'Carl')
    ok('with the peer published, the code names it in the fragment too', /&p=did%3Apeer/.test(link2) && /&pn=Demo\+inventory/.test(link2), link2)
    ok('the card says Jakob and the demo inventory can be asked', /and Demo inventory/.test(await text(a.locator('.qr-facts'))))
    await shot(a, '15-jakob-carl-demo-code-with-peer')
    const b2 = await mk()
    await b2.goto(link2)
    await b2.getByRole('button', { name: 'Start as Carl-demo' }).click()
    await b2.locator('.query-dock').waitFor({ timeout: 20_000 })
    await b2.locator('.node', { hasText: 'Demo inventory' }).waitFor({ timeout: 20_000 })
    const nodes = await b2.locator('.node:not(.you) span').allInnerTexts()
    ok('Carl-demo is connected to Jakob and to the demo inventory', nodes.includes('Jakob') && nodes.includes('Demo inventory'), JSON.stringify(nodes))
    await a.getByRole('button', { name: 'Back' }).click()
    await allowOn(a, 'Carl-demo', 'card')
    await b2.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
    if (peer) {
      for (let i = 0; i < 50 && peer.peerCount() < 1; i++) await new Promise((r) => setTimeout(r, 100))
      ok('the peer holds Carl-demo as its peer', peer.peerCount() === 1)
    } else {
      await new Promise((r) => setTimeout(r, 3000)) // live: the peer's own count is in its journal, not here
    }
    await shot(b2, '16-carl-connected-two-peers')
    await b2.locator('.query-dock textarea').fill('Does anyone have a motorbike I could borrow?')
    await b2.getByRole('button', { name: 'Call into my web' }).click()
    // Jakob's phone has no motorbike: it stays silent; the peer answers alone.
    await b2.locator('.card.asked .outcome').waitFor({ timeout: 90_000 })
    const outcome2 = await b2.locator('.card.asked .outcome').innerText()
    ok('the demo inventory answers by itself after the window', /Demo inventory chose to share/.test(outcome2) && /Motorbike/.test(outcome2), outcome2)
    ok('Jakob was not prompted (nothing of his matched)', (await a.locator('.overlay.on').count()) === 0)
    if (peer) ok('the peer logged the outcome, never the ask', peerLog.some((l) => /ask shared/.test(l)) && !peerLog.some((l) => /motorbike/i.test(l)))
    else console.log('  NOTE  live: the peer log is the journal on questhub (journalctl -u trustweb-peer); check it by hand')
    await shot(b2, '17-carl-answer-from-peer')
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } catch (e) {
    // An exception must count: the finally below exits the process before main().catch could.
    failures++
    console.log('  FAIL  exception  ->  ' + (e instanceof Error ? e.stack ?? e.message : String(e)))
  } finally {
    await peer?.stop()
    await browser?.close()
    if (viteProc) await stopVite(viteProc)
    backupProc?.kill('SIGTERM')
    await relay?.close()
    rmSync(scratch, { recursive: true, force: true })
    console.log(failures ? `\n${failures} FAILED` : '\nall passed')
    process.exit(failures ? 1 : 0)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
