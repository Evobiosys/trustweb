/**
 * Wave 19: Bo composes "I want to play padel in Wien with me", picks the place with the dock's button (browser geolocation, mocked
 * position, asked only on the tap), sends; the place is remembered with its coordinates. Ada has a padel line and her own together
 * setting (padel, Wien): her prompt shows "Fits your padel settings".
 * Ports: Vite TW_PORT (8970), TLS front TW_PORT+1. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/together_wired_flow.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const TW_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = Number(process.env.TW_PORT || 8970)
const HOST = 'app.trustweb.one'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

async function newPhone(browser, server) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true,
    permissions: ['clipboard-read', 'clipboard-write', 'geolocation'], geolocation: { latitude: 48.20849, longitude: 16.37208 },
  })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return { ctx, page }
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

async function showCode(page, server) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return until(async () => {
    const shown = await page.getAttribute('.qrwrap', 'data-payload')
    return [...server.codes.keys()].find((c) => shown === `${ORIGIN}/c/${c}`) ?? null
  }, 15_000)
}

async function openAndAdd(page, code) {
  await page.goto(`${ORIGIN}/c/${code}`)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  await page.locator('.sheet.on [data-ring="friend"]').click()
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').first().waitFor({ timeout: 10_000 })
}

/** Relay + the crm's Vite (the one that serves this app, apps/demo's is an older major) on `port`. */
async function startApp(port) {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = spawn(process.execPath, [path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(port), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` }, stdio: 'ignore',
  })
  for (let i = 0; i < 120; i++) {
    if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  return { stop: async () => { vite.kill('SIGTERM'); await relay.close?.() } }
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: PORT + 1, appPort: PORT, host: HOST })
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    // TW_CHROMIUM: path of a cached chrome-headless-shell when the cache holds another revision than this playwright-core wants.
    browser = await (pw.chromium ? pw : pw.default).chromium.launch({
      headless: true, ...(process.env.TW_CHROMIUM ? { executablePath: process.env.TW_CHROMIUM } : {}), args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT + 1}`],
    })
    const server = fakeConnectServer(ORIGIN)
    const a = await newPhone(browser, server)
    await startPhone(a.page, 'Ada')
    const code = await showCode(a.page, server)
    await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})
    const b = await newPhone(browser, server)
    await startPhone(b.page, 'Bo')
    await openAndAdd(b.page, code)
    await until(async () => (await a.page.locator('.node:not(.you)').allInnerTexts()).some((x) => x.includes('Bo')))
    await a.page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      r.inventory.push({ id: 'w19padel', text: 'Padel court in Wien', audience: 'fof', included: true, createdAt: Date.now() })
      r.togetherPrefs = [{ at: Date.now(), activity: 'padel', area: 'Wien' }]
      localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
    })
    await a.page.reload()
    await a.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })

    const p = b.page
    await p.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {})
    await p.keyboard.press('Escape').catch(() => {})
    await p.locator('nav.tabs button', { hasText: 'Membranes' }).click()
    if (await p.locator('.query-dock').count() === 0) await p.getByRole('button', { name: 'Ask your web', exact: true }).click()
    t.ok('the place button is there and nothing is chosen yet', await p.locator('[data-together-pick]').count() === 1 && await p.locator('[data-together-place-chosen]').count() === 0)
    await p.locator('.query-dock textarea').fill('I want to play padel in Wien with me')
    await p.locator('[data-together-pick]').click()
    await p.locator('[data-together-place-chosen]').waitFor({ timeout: 5000 })
    t.ok('the picked place shows as a chip named by the typed words', /Near Wien/.test(await p.locator('[data-together-place-chosen]').innerText()))
    await p.getByRole('button', { name: 'Ask my web' }).click()
    t.ok('first tap shows the compiled sentence with the place', /Looking for company: play padel near Wien/.test(await p.locator('.query-dock textarea').inputValue()))
    await p.getByRole('button', { name: 'Ask my web' }).click()
    const pref = (await record(p)).togetherPrefs?.[0]
    t.ok('the place is remembered with its coordinates (rounded)', pref?.activity === 'padel' && pref.area === 'Wien' && pref.lat === 48.21 && pref.lon === 16.37, JSON.stringify(pref))
    const shown = await until(async () => (await a.page.locator('.overlay.on').count()) > 0 ? a.page.locator('.overlay.on').innerText() : null, 25_000)
    t.ok('Ada gets the ask', /Bo asks/.test(shown ?? '') && /Looking for company/.test(shown ?? ''), String(shown))
    t.ok('and sees "Fits your padel settings"', /Fits your padel settings/.test(shown ?? '') && await a.page.locator('[data-together-fit]').count() === 1)
    await shot(a.page, 'w19_fit_prompt.png')
    await a.ctx.close(); await b.ctx.close()
  } finally {
    await browser?.close()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nTOGETHER WIRED FLOW: ALL PASS' : `\nTOGETHER WIRED FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
