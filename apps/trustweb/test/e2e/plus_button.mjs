/**
 * Web -> Manage -> "Note someone new" must open the exact same Record flow as
 * the raised Record tab -- not a forked one -- and finishing Place -> "Save to
 * my web" must return to Web with the new person visible. Also pins the
 * 2026-10-05 nav: exactly Web | Record | Inventory, Query on the Web screen.
 *
 * Local only (spins up a real RelayServer + Vite dev server), single phone.
 *
 * Run from apps/demo/ (it has tsx and the toolchain):
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/plus_button.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5199)

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
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitForServer(base)
  console.log('plus-button smoke against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  const browser = await engine.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    await page.goto(base)

    await page.getByLabel('Your first name').fill('Smoke Tester')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('boots on Web screen', true)
    const tabs = await page.locator('nav.tabs button').allInnerTexts()
    ok('nav is exactly Web | Record | Inventory', JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['Web', 'Record', 'Inventory']), JSON.stringify(tabs))
    ok('Query sits on the Web screen', await page.getByRole('button', { name: 'Query' }).isVisible())
    ok('no "Online" text in the header', !(await page.locator('.hdr').innerText()).includes('Online'))

    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('heading', { name: 'Connections' }).waitFor({ timeout: 10_000 })
    ok('Manage lists the connections', true)
    await page.getByRole('button', { name: /Note someone new/ }).click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 10_000 })
    ok('Note someone new opens the Record flow (not a fork)', true)

    await page.getByLabel('Who are you meeting?').fill('Plus Person')
    await page.locator('textarea.note').fill('Looking for a co-founder')
    await page.getByRole('button', { name: 'Make notes' }).click()
    await page.getByRole('heading', { name: /Notes about Plus Person/ }).waitFor({ timeout: 10_000 })
    ok('proceeds to Review with the typed note', true)

    await page.getByRole('button', { name: 'Looks right' }).click()
    await page.getByRole('heading', { name: /Plus Person is my/ }).waitFor({ timeout: 10_000 })
    await page.getByText('Acquaintance', { exact: false }).first().click()
    await page.getByRole('button', { name: 'Save to my web' }).click()

    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 10_000 })
    const bodyText = await page.locator('.scroll').first().innerText()
    ok('back on Web with the new person visible', bodyText.includes('Plus Person'), bodyText.slice(0, 200))
    ok('Record is still the raised middle tab', await page.locator('nav.tabs .tab-record').isVisible())
  } finally {
    await browser.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nplus-button smoke: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
