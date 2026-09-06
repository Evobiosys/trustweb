/**
 * The notification rule (Jakob's confirmed reading, 2026-09-04 session, and
 * DEVLOG/handover-build-session-2026-09-04.md §7.1):
 *
 *   "A device WITH a match surfaces the consent prompt wherever the person
 *    is in the app. A device with NOTHING stays silent and only logs."
 *
 * and the best-faith reproduction of the 2026-09-01 Vienna demo debrief
 * ("it wasn't possible to see the motorbike that one person listed on the
 * other phone"), using the app's own architecture: Marlene (holder) writes
 * "Motorrad" into "Was ich habe"; Nora (seeker) asks the network for it via
 * "Ins Netzwerk rufen" (free text).
 *
 * WHY A REAL BROWSER, not the existing Node-direct e2e style
 * (call_into_the_web.mjs, relay_query_answer.mjs, ...): those import the
 * app's TS modules straight into Node and call classifyIncomingQuery()/
 * decide() directly. They prove the DECISION is correct but cannot prove
 * the SCREEN actually changes when a match arrives on a device the person
 * is not looking at -- exactly the reported symptom ("a phone looked like
 * nothing happened"). This script drives the real DOM (main.ts's
 * shell()/go()/render()) in two independent headless Chromium contexts, so
 * a regression where the decision is right but the render never fires
 * would show up here and nowhere else in this repo's test suite.
 *
 * WHY A LOCAL RELAY, not questhub.eco: deterministic, offline, no shared
 * state with anyone else hitting the production relay. Reuses
 * packages/transport's REAL RelayServer (not a mock) with an in-memory
 * queue store -- the same code questhub.eco runs, per result-report-
 * demo20.md's own precedent ("packages/transport/relay_only.ts on
 * localhost:4177 -- the same RelayServer code questhub.eco runs in
 * production, not a mock; a temporary dev-only Vite proxy made the
 * CORS-locked POST /relay/send work"). Following that precedent exactly:
 * the proxy lives in a TEMP vite config this script writes and deletes,
 * never in the committed apps/demo/vite.config.ts (relay.ts's ingress is
 * deliberately origin-locked -- see its own module header -- and that
 * posture is not something this test should have to touch, even
 * temporarily, in a file anyone else's dev server also reads).
 *
 * WHY THE REAL ONE-SCAN CONNECT LINK, not just relying on the two demo
 * personas' pre-seeded pairing: the pre-seeded pairing (main.ts's
 * seedPersona(), DEMO_NONCE) gives both devices the SAME symmetric key so
 * the QR-only demo (demo 1) can show a real decrypt with no ceremony, but
 * it deliberately carries NO relay `did` (state.ts's own doc comment on
 * Peer.did: "a SEEDED pairing has no `did` at all -- there is no ceremony
 * a seed could have minted one from"). Relay-mode delivery (what this test
 * needs, to exercise the ambient ammbient/global-listener path rather than
 * a manual QR scan) requires a real did, which only completeConnectLinkIfPending()
 * (main.ts) produces. So: Marlene shows her connect link
 * (data-payload on .qrwrap, put there BY THE APP specifically so a
 * headless test can read a code without a camera -- see showCodeScreen's
 * own comment), Nora's fresh context opens that URL before picking a
 * persona, exactly like a phone's camera app opening a link it cannot make
 * sense of any other way (connect_link.ts's own module header).
 *
 * Run (from apps/demo/):
 *   npx tsx test/e2e/motorrad_notification_browser.mjs
 *
 * Env overrides: WOT_VITE_PORT (default 5199), PLAYWRIGHT_PACKAGE (default
 * 'playwright'; point at an installed playwright-core's entry file if this
 * repo's own devDependency isn't installed -- see this repo's own e2e
 * scripts, e.g. screenshots.mjs, for the same convention).
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Imported from the specific source files, not packages/transport's own
// barrel (src/index.ts): that barrel also re-exports mock_transport.ts,
// which pulls in the WORKSPACE package @resource-web/protocol by name --
// resolvable only once that package has been built (`pnpm -r build`).
// RelayServer and InMemoryRelayQueueStore have no such dependency, so
// importing them directly here means this script runs straight off a
// fresh `pnpm install`, no build step required, exactly like the
// `../../src/*.ts` imports the rest of this directory's e2e scripts use.
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO_ROOT = path.resolve(HERE, '../..')
const VITE_PORT = Number(process.env.WOT_VITE_PORT || 5199)
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`)
  }
}

// ---------------------------------------------------------------------------
// i18n strings this script asserts on -- pinned here, in German (the app's
// default `lang`, i18n.ts), rather than importing i18n.ts's t() into a Node
// context it was never meant to run in. If a copy change breaks this
// script, that is the same signal call_into_the_web.mjs's own comment on
// this repo's traps warns about ("renaming copy silently invalidates test
// selectors") -- fix the string here, not the app, unless the app's own
// wording is genuinely wrong.
const STR = {
  continueAsMarlene: /Weiter als Marlene/,
  continueAsNora: /Weiter als Nora/,
  navConnect: 'Verbinden',
  showConnectLink: 'Verbindungslink zeigen',
  navAsk: 'Fragen',
  navProfile: 'Mein Profil',
  navInventory: /Was ich habe/,
  navLog: /Protokoll/,
  askFreeTextSubmit: 'Ins Netzwerk rufen',
  seeWhat: 'Zeigen, was geteilt würde',
  yesShare: 'Ja, teilen',
  back: 'Zurück',
  askedYou: 'fragt',
  outNothing: 'Keine Antwort',
}

/**
 * The current screen's title, as shown in shell()'s (main.ts) topbar --
 * `.topbar .who`'s first text node is always exactly `t(<screen's own
 * title key>)`, e.g. "Mein Profil". profile.ts/inventory.ts/etc. render no
 * `<h1>` of their own for a plain screen (only the consent ceremony and a
 * few others do, via el('h1', ...) inside the body) -- the topbar title is
 * the one thing every screen this app has always sets, so it is the
 * reliable "which screen is this" signal for a test, not any one screen's
 * body markup.
 */
async function currentTitle(page) {
  return page.locator('.topbar .who').first().evaluate((el) => el.childNodes[0]?.textContent ?? '')
}

async function waitForServer(url, timeoutMs = 20_000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server never came up at ${url}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function main() {
  // -------------------------------------------------------------------
  // 1. Local relay -- real RelayServer, in-memory queue, ephemeral port.
  // -------------------------------------------------------------------
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  console.log(`motorrad_notification_browser: local relay on 127.0.0.1:${relayPort}`)

  // -------------------------------------------------------------------
  // 2. Temp vite config -- dev server at VITE_PORT, /relay proxied to the
  //    local relay above (ws:true so the drain socket, not just the
  //    ingress POST, actually reaches it). Never touches the committed
  //    vite.config.ts.
  // -------------------------------------------------------------------
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'wot-motorrad-vite-'))
  const tmpConfigPath = path.join(tmpDir, 'vite.config.mjs')
  await writeFile(
    tmpConfigPath,
    `import { defineConfig } from ${JSON.stringify(path.join(DEMO_ROOT, 'node_modules/vite/dist/node/index.js'))}
export default defineConfig({
  base: '/',
  server: {
    host: '127.0.0.1',
    port: ${VITE_PORT},
    strictPort: true,
    proxy: { '/relay': { target: 'http://127.0.0.1:${relayPort}', ws: true, changeOrigin: true } },
  },
})
`,
  )

  const viteBin = path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js')
  const viteProc = spawn(process.execPath, [viteBin, '--config', tmpConfigPath], {
    cwd: DEMO_ROOT,
    env: { ...process.env, VITE_WOT_MODE: 'relay' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let viteLog = ''
  viteProc.stdout.on('data', (d) => { viteLog += d.toString() })
  viteProc.stderr.on('data', (d) => { viteLog += d.toString() })

  const playwrightMod = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const chromium = playwrightMod.chromium ?? playwrightMod.default?.chromium
  let browser = null

  try {
    await waitForServer(APP_URL)
    console.log(`motorrad_notification_browser: vite dev up at ${APP_URL}`)

    browser = await chromium.launch({ headless: true })
    const marleneCtx = await browser.newContext()
    const marlene = await marleneCtx.newPage()
    marlene.on('pageerror', (err) => console.log('  [marlene pageerror]', err.message))

    // -----------------------------------------------------------------
    // Marlene: pick persona, get her connect link.
    // -----------------------------------------------------------------
    await marlene.goto(APP_URL, { waitUntil: 'networkidle' })
    await marlene.getByRole('button', { name: STR.continueAsMarlene }).click()
    await marlene.getByRole('button', { name: STR.navConnect }).click()
    await marlene.getByRole('button', { name: STR.showConnectLink }).click()
    const qrwrap = marlene.locator('.qrwrap[data-payload]')
    await qrwrap.waitFor({ state: 'attached', timeout: 10_000 })
    const connectUrl = await qrwrap.getAttribute('data-payload')
    ok('Marlene produced a connect link', typeof connectUrl === 'string' && connectUrl.includes('connect='), connectUrl ?? '')

    // -----------------------------------------------------------------
    // Nora: a FRESH context/device opens Marlene's link before picking
    // a persona -- exactly the one-scan ceremony connect_link.ts exists
    // for (a phone whose camera can only offer to open a link).
    // -----------------------------------------------------------------
    const noraCtx = await browser.newContext()
    const nora = await noraCtx.newPage()
    nora.on('pageerror', (err) => console.log('  [nora pageerror]', err.message))
    await nora.goto(connectUrl, { waitUntil: 'networkidle' })
    ok('Nora\'s start screen names who invited her', await nora.getByText(/Marlene/).count() > 0)
    await nora.getByRole('button', { name: STR.continueAsNora }).click()
    // completeConnectLinkIfPending() ends on the connect screen once the
    // ack has been sent -- wait for it rather than a fixed sleep.
    await nora.getByRole('heading', { name: /Verbind/ }).first().waitFor({ timeout: 10_000 })

    await marlene.getByRole('button', { name: STR.back }).click() // connect -> home

    // -----------------------------------------------------------------
    // Marlene lists "Motorrad" in "Was ich habe", then walks AWAY to an
    // unrelated screen (Profile) -- the whole point of this test.
    // -----------------------------------------------------------------
    await marlene.getByRole('button', { name: STR.navInventory }).click()
    const invInput = marlene.locator('input[type=text]')
    await invInput.fill('Motorrad')
    await invInput.press('Enter')
    await marlene.getByRole('button', { name: STR.back }).click() // inventory -> home
    await marlene.getByRole('button', { name: STR.navProfile }).click()
    ok('Marlene is on Profile, not Answer, before Nora asks', (await currentTitle(marlene)) === STR.navProfile)

    // -----------------------------------------------------------------
    // POSITIVE CASE: Nora calls "Motorrad" into the network.
    // -----------------------------------------------------------------
    await nora.getByRole('button', { name: STR.back }).click() // connect -> home
    await nora.getByRole('button', { name: STR.navAsk }).click()
    const freeTextInput = nora.locator('input[type=text]')
    await freeTextInput.fill('Motorrad')
    await nora.getByRole('button', { name: STR.askFreeTextSubmit }).click()

    // Marlene must surface the consent ceremony UNPROMPTED, from Profile.
    const askedHeading = marlene.getByRole('heading', { name: new RegExp(STR.askedYou) })
    let surfaced = false
    try {
      await askedHeading.waitFor({ timeout: 10_000 })
      surfaced = true
    } catch {
      surfaced = false
    }
    ok('Marlene\'s screen surfaces the consent ceremony from Profile, unprompted (the notification rule)', surfaced)
    if (surfaced) {
      ok('Marlene no longer shows the Profile screen she was on', (await currentTitle(marlene)) !== STR.navProfile)
      await marlene.getByRole('button', { name: STR.seeWhat }).click().catch(() => {})
      const quoteText = await marlene.locator('.quote').first().innerText().catch(() => '')
      ok('The surfaced match is literally the Motorrad entry', quoteText.includes('Motorrad'), quoteText)
      await marlene.getByRole('button', { name: STR.yesShare }).click()

      const outcomeShared = nora.locator('.outcome.shared')
      await outcomeShared.waitFor({ timeout: 15_000 }).catch(() => {})
      ok('Nora receives a shared answer', await outcomeShared.count() > 0)
      const noraQuote = await nora.locator('.quote').first().innerText().catch(() => '')
      ok('Nora\'s received answer contains "Motorrad"', noraQuote.includes('Motorrad'), noraQuote)
      await nora.getByRole('button', { name: /Fertig|Done/ }).click().catch(() => {})
    }

    // -----------------------------------------------------------------
    // NEGATIVE CASE: Nora calls for something Marlene has nothing about,
    // while Marlene sits on Profile again. Marlene's screen must NOT
    // move; the query must still be logged (I6).
    // -----------------------------------------------------------------
    await marlene.getByRole('button', { name: STR.back }).click() // wherever the ceremony left her -> home
    // Baseline query-log count, read right before THIS ask (the positive
    // case already logged one entry of its own -- this is a delta check
    // across exactly the silent query, not across the whole script).
    const logCountBefore = await readLogCount(marlene)
    await marlene.getByRole('button', { name: STR.navProfile }).click()
    ok('Marlene is back on Profile for the negative case', (await currentTitle(marlene)) === STR.navProfile)

    await nora.getByRole('button', { name: STR.navAsk }).click().catch(async () => {
      await nora.getByRole('button', { name: STR.back }).click()
      await nora.getByRole('button', { name: STR.navAsk }).click()
    })
    const freeTextInput2 = nora.locator('input[type=text]')
    await freeTextInput2.fill('Kettensäge')
    await nora.getByRole('button', { name: STR.askFreeTextSubmit }).click()

    const noraNothing = nora.locator('.outcome.nothing')
    await noraNothing.waitFor({ timeout: 15_000 }).catch(() => {})
    ok('Nora is told honestly that nothing came back (no side channel on outcome)', await noraNothing.count() > 0)

    // Give Marlene's page every chance to have (wrongly) navigated before
    // asserting it did not.
    await marlene.waitForTimeout(1_500)
    ok('Marlene\'s screen never moved for the non-match (silent + log-only)', (await currentTitle(marlene)) === STR.navProfile)

    await marlene.getByRole('button', { name: STR.back }).click()
    const logCountAfter = await readLogCount(marlene)
    ok(
      'Marlene\'s query log grew by exactly one for the silent query (I6 auditability)',
      logCountAfter === logCountBefore + 1,
      `before=${logCountBefore} after=${logCountAfter}`,
    )
  } finally {
    if (browser) await browser.close().catch(() => {})
    viteProc.kill('SIGTERM')
    await new Promise((resolve) => {
      viteProc.once('exit', resolve)
      setTimeout(resolve, 3_000)
    })
    await relay.close().catch(() => {})
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (failures) console.log('\n--- vite dev server log (for debugging) ---\n' + viteLog.slice(-4000))
  }

  console.log(`\nmotorrad_notification_browser: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
  process.exitCode = failures ? 1 : 0
}

/** Reads the "(N)" count off Home's "Protokoll (N)" button -- the same
 *  count the app itself shows, not a re-derivation of it. Assumes `page`
 *  is currently on the home screen. */
async function readLogCount(page) {
  const text = await page.getByRole('button', { name: STR.navLog }).innerText()
  const m = text.match(/\((\d+)\)/)
  if (!m) throw new Error(`could not read log count from "${text}"`)
  return Number(m[1])
}

await main()
