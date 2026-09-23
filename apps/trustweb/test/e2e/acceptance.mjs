/**
 * TrustWeb acceptance test, in a real headless browser, through the solo
 * split view (solo.html): two personas, two relay identities, paired through
 * the real one-scan connect link, talking over a real relay.
 *
 *   1. English "motorbike" ask -> Maya's consent prompt appears with the
 *      motorbike line -> she shares -> Jonas sees it after the 30 s window.
 *   2. An unrelated English ask -> Maya's phone stays silent (no prompt),
 *      Jonas sees "No match", Maya's log records "stayed silent".
 *   3. A matching ask Maya declines -> Jonas sees the same "No match".
 *
 * Local (default): starts packages/transport's real RelayServer on an
 * ephemeral port and apps/trustweb's Vite dev server with /relay proxied to it.
 * Live: TW_URL=https://app.idea2.site/trustweb/ runs the same steps against
 * the deployed app and its production relay.
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
  console.log('trustweb acceptance against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const chromium = pw.chromium ?? pw.default?.chromium
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base + 'solo.html')
    const maya = page.frameLocator('iframe[title="Maya\'s phone"]')
    const jonas = page.frameLocator('iframe[title="Jonas\'s phone"]')

    await maya.getByRole('heading', { name: 'Your Web' }).waitFor({ timeout: 20_000 })
    ok('Maya\'s phone boots on the Web screen', true)
    await jonas.getByRole('button', { name: 'Query' }).click({ timeout: 30_000 })
    const askBtn = jonas.getByRole('button', { name: 'Ask my web' })
    await page.waitForFunction(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Jonas's phone")
      const b = [...(f?.contentDocument?.querySelectorAll('button') ?? [])].find((x) => x.textContent === 'Ask my web')
      return b && !b.disabled
    }, null, { timeout: 30_000 })
    ok('Jonas is paired with Maya (Ask enabled)', true)

    const promptVisible = () => maya.locator('.overlay.on').isVisible()
    const ask = async (text) => {
      await jonas.locator('textarea').fill(text)
      await askBtn.click()
    }
    const waitResult = () => jonas.locator('.card.asked .outcome').first().waitFor({ timeout: 90_000 })

    // 1. match + share
    await ask('Does anyone have a motorbike I could borrow?')
    await maya.getByText('Jonas asks').waitFor({ timeout: 20_000 })
    const matched = await maya.locator('.ask-line').allInnerTexts()
    ok('Maya\'s consent prompt appears for the English motorbike ask', true)
    ok('the prompt shows the motorbike line', matched.some((t) => /Motorbike/.test(t)), JSON.stringify(matched))
    await maya.getByRole('button', { name: 'Share these' }).click()
    await waitResult()
    const shared = await jonas.locator('.card.asked').innerText()
    ok('Jonas receives what Maya shared', /Maya chose to share/.test(shared) && /Motorbike/.test(shared), shared)
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
    await maya.getByRole('button', { name: 'Inventory' }).click()
    const log = await maya.locator('.log').first().innerText()
    ok('Maya\'s log records the silent ask', /piano/.test(log) && /stayed silent/.test(log), log)

    // 3. matching ask, declined: indistinguishable from no match
    await ask('Anyone got a motorcycle?')
    await maya.getByText('Jonas asks').waitFor({ timeout: 20_000 })
    await maya.getByRole('button', { name: 'Don\'t share' }).click()
    await waitResult()
    const declined = await jonas.locator('.card.asked').innerText()
    ok('a decline shows Jonas the same "No match"', /No match/.test(declined) && !/chose to share/.test(declined), declined)
    if (process.env.TW_SHOT) await page.screenshot({ path: process.env.TW_SHOT })
  } finally {
    await browser.close().catch(() => {})
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
