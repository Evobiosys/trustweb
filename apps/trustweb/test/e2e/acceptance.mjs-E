/**
 * TrustWeb acceptance test, in a real headless browser, through the solo
 * split view (solo.html): two personas, two relay identities, paired through
 * the real one-scan connect link, talking over a real relay.
 *
 *   1. English "loudspeakers" ask -> Maya's consent prompt appears with the
 *      Loudspeakers line -> she shares -> Jonas sees it after the 30 s window.
 *   2. An unrelated English ask -> Maya's phone stays silent (no prompt),
 *      Jonas sees "No match", Maya's log records "stayed silent".
 *   3. A matching ask Maya declines -> Jonas sees the same "No match".
 *
 * Local (default): starts packages/transport's real RelayServer on an
 * ephemeral port and apps/trustweb's Vite dev server with /relay proxied to it.
 * Live: TW_URL=https://app.idea2.site/trustweb/ runs the same steps against
 * the deployed app and its production relay.
 *
 * TW_BROWSER=webkit|chromium (default chromium) picks the engine.
 *
 * Run from apps/demo/ (it has tsx and the toolchain):
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/acceptance.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const LIVE = process.env.TW_URL
const PORT = Number(process.env.TW_PORT || 5191)

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

async function main() {
  let relay = null
  let viteProc = null
  let base = LIVE
  if (!LIVE) {
    const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port: relayPort } = await relay.listen(0, '127.0.0.1')
    viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
      cwd: TW_ROOT,
      env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    base = `http://127.0.0.1:${PORT}/`
    await waitForServer(base)
  }
  console.log('trustweb acceptance against ' + base + ' in ' + (process.env.TW_BROWSER || 'chromium'))

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  // TW_BROWSER=webkit runs the same steps in WebKit (Safari's engine).
  const engine = (pw.chromium ? pw : pw.default)[process.env.TW_BROWSER || 'chromium']
  // A launch failure (e.g. a missing browser build) must still stop the dev
  // server and relay below, or the orphaned Vite process keeps this run alive.
  let browser = null
  try {
    browser = await engine.launch({ headless: true })
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base + 'solo.html')
    // The page starts with one unnamed device at "Your first name" (2026-10-05).
    ok('the side-by-side page starts with one device', await page.locator('iframe').count() === 1)
    const maya = page.frameLocator('iframe[title="Device 1"]')
    const jonas = page.frameLocator('iframe[title="Device 2"]')
    await maya.getByLabel('Your first name').fill('Maya')
    await maya.getByRole('button', { name: 'Start on this phone' }).click()
    await maya.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
    ok('the first device starts like a real phone, then shows the seeded web', true)
    await page.getByRole('button', { name: /Add a device/ }).click()
    await jonas.getByRole('button', { name: 'Connect', exact: true }).waitFor({ timeout: 30_000 })
    ok('an added device is called Jonas by default', (await jonas.getByLabel('Your first name').inputValue()) === 'Jonas')
    await jonas.getByRole('button', { name: 'Connect', exact: true }).click()
    // Query lives on the Web screen (bottom right) and opens a dock under the rings.
    await jonas.getByRole('button', { name: 'Call into your web' }).click({ timeout: 30_000 })
    ok('Jonas\'s rings stay visible while querying', await jonas.locator('.rings-wrap').isVisible())
    const askBtn = jonas.getByRole('button', { name: 'Call into my web' })
    await page.waitForFunction(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Device 2")
      const b = [...(f?.contentDocument?.querySelectorAll('button') ?? [])].find((x) => x.textContent === 'Call into my web')
      return b && !b.disabled
    }, null, { timeout: 30_000 })
    ok('Jonas is paired with Maya (Ask enabled)', true)

    const promptVisible = () => maya.locator('.overlay.on').isVisible()
    const ask = async (text) => {
      await jonas.locator('textarea').fill(text)
      await askBtn.click()
    }
    const waitResult = () => jonas.locator('.card.asked .outcome').first().waitFor({ timeout: 200_000 })

    // 1. match + share
    await ask('Does anyone have loudspeakers I could borrow?')
    await maya.getByText('Jonas asks').waitFor({ timeout: 20_000 })
    const matched = await maya.locator('.ask-line').allInnerTexts()
    ok('Maya\'s consent prompt appears for the English loudspeakers ask', true)
    ok('the prompt shows the Loudspeakers line (and never the OnlyMe room)', matched.some((t) => /Loudspeakers/.test(t)) && !matched.some((t) => /visiting friends/.test(t)), JSON.stringify(matched))
    await maya.getByRole('button', { name: 'Share these' }).click()
    await waitResult()
    const shared = await jonas.locator('.card.asked').innerText()
    ok('Jonas receives what Maya shared', /Maya chose to share/.test(shared) && /Loudspeakers/.test(shared), shared)
    const glow = await jonas.locator('.node.shared').allInnerTexts()
    ok('Maya glows on Jonas\'s rings as the one who shared', glow.length === 1 && /Maya/.test(glow[0]), JSON.stringify({ glow, nodes: await jonas.locator('.node').allInnerTexts() }))
    await maya.getByRole('button', { name: 'Back to the app' }).click()

    // 2. unrelated ask: silence
    await ask('Does anyone know a good piano teacher?')
    let sawPrompt = false
    const t0 = Date.now()
    while (Date.now() - t0 < 90_000) {
      if (await promptVisible()) { sawPrompt = true; break }
      if (await jonas.locator('.card.asked .outcome').count()) break
      await page.waitForTimeout(500)
    }
    ok('Maya\'s phone stays silent for an unrelated ask', !sawPrompt)
    await waitResult()
    const nothing = await jonas.locator('.card.asked').innerText()
    ok('Jonas sees "No match"', /No match/.test(nothing), nothing)
    await maya.getByRole('button', { name: 'My Resources' }).click()
    await maya.getByRole('button', { name: 'Review requests' }).click()
    const log = await maya.locator('.log').first().innerText()
    await maya.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('Maya\'s log records the silent ask', /piano/.test(log) && /stayed silent/.test(log), log)

    // 3. matching ask, declined: indistinguishable from no match
    await ask('Anyone got some speakers?')
    await maya.getByText('Jonas asks').waitFor({ timeout: 20_000 })
    await maya.getByRole('button', { name: 'Don\'t share' }).click()
    await waitResult()
    const declined = await jonas.locator('.card.asked').innerText()
    ok('a decline shows Jonas the same "No match"', /No match/.test(declined) && !/chose to share/.test(declined), declined)
    if (process.env.TW_SHOT) await page.screenshot({ path: process.env.TW_SHOT })
  } finally {
    await browser?.close().catch(() => {})
    if (viteProc) {
      viteProc.kill('SIGTERM')
      await new Promise((r) => { viteProc.once('exit', r); setTimeout(r, 3000) })
    }
    if (relay) await relay.close().catch(() => {})
  }
  console.log(`\ntrustweb acceptance: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
  process.exitCode = failures ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
