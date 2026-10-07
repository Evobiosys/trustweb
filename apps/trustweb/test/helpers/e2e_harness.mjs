/**
 * Shared harness for the wave-5 e2e files: a real RelayServer and the Vite dev server on loopback, a headless
 * Chromium, and the PASS/FAIL tally. Run the files from apps/demo with tsx (the sources are .ts):
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8984 ../../node_modules/.bin/tsx ../trustweb/test/e2e/<file>.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')

export function tally() {
  const t = { failures: 0 }
  t.ok = (name, cond, detail = '') => {
    if (cond) console.log(`  PASS  ${name}`)
    else { t.failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
  }
  return t
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

/** Starts relay + Vite on `port`; `stop()` ends both. */
export async function startApp(port) {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(port), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${port}/`
  await waitForServer(base)
  return {
    base,
    async stop() { vite.kill('SIGTERM'); await relay.close?.() },
  }
}

export async function launch(args = []) {
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  return (pw.chromium ? pw : pw.default).chromium.launch({ headless: true, args })
}

/** Starts a fresh phone: types the name and lands on the Web screen. */
export async function startPhone(page, base, name = 'Smoke Tester') {
  await page.goto(base)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
}
