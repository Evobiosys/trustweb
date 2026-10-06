/**
 * Local servers for the round-B e2e suites (wave 1733): a relay, the Swiss
 * server (services/trustweb-backup) with hosting, feedback and transcription
 * against a FAKE provider (the async submit-and-poll shape of Infomaniak's
 * AI Tools, as services/trustweb-backup/test/transcribe.test.mjs fakes it),
 * and Vite proxying /relay, /backup, /hosted, /transcribe, /feedback.
 * Everything binds 127.0.0.1 on ports 5290-5299 (the handover's range) or 0,
 * and stop() takes it all down. Never production.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const SERVER = path.resolve(TW_ROOT, '../../services/trustweb-backup/server.mjs')
const PRODUCT = '42'

export async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).status < 500) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not come up: ' + url)
}

/**
 * The fake provider. `hold` keeps every job "processing" until release();
 * `segments` is what a finished job returns; `submits` counts the audio calls.
 */
export async function startFakeProvider(port) {
  const state = {
    hold: false,
    submits: 0,
    segments: [
      { id: 0, start: 0, end: 2.1, text: ' I can lend my cargo bike on weekends.' },
      { id: 1, start: 2.1, end: 4.8, text: 'We are looking for a flat in Graz.' },
    ],
  }
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain the multipart upload */ }
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.method === 'POST' && req.url === `/1/ai/${PRODUCT}/openai/audio/transcriptions`) {
      state.submits++
      return json(200, { batch_id: 'b' + state.submits })
    }
    if (req.method === 'GET' && req.url?.startsWith(`/1/ai/${PRODUCT}/results/`)) {
      if (state.hold) return json(200, { status: 'processing' })
      const text = state.segments.map((s) => s.text).join(' ')
      return json(200, { status: 'success', data: { task: 'transcribe', language: 'en', duration: 4.8, text, segments: state.segments } })
    }
    json(404, {})
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    state,
    url: `http://127.0.0.1:${port}/1/ai/${PRODUCT}/openai/audio/transcriptions`,
    stop: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }),
  }
}

/** The Swiss server on `port`: hosting + feedback always, transcription only with a provider URL. */
export async function startSwissServer(port, { providerUrl = '', extraEnv = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-swiss-'))
  const env = {
    ...process.env,
    BACKUP_DIR: path.join(dir, 'backup'), HOSTED_DIR: path.join(dir, 'hosted'), FEEDBACK_FILE: path.join(dir, 'feedback.jsonl'),
    PORT: String(port), HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost',
    // Every phone in a test comes from 127.0.0.1: the per-address limits would trip on polling alone.
    RATE_LIMIT: '2000', ACCOUNT_CREATES_PER_IP_DAY: '200', HOSTED_WRITES_PER_HOUR_PER_IP: '2000', REC_GETS_PER_HOUR: '2000',
    HOSTED_MIN_FREE_BYTES: '0', TRANSCRIBE_POLL_MS: '150', TRANSCRIBE_IP_DAILY_SECONDS: '36000', TRANSCRIBE_DAILY_SECONDS: '72000',
    ...(providerUrl ? { TRANSCRIBE_URL: providerUrl, TRANSCRIBE_KEY: 'test-key-not-real' } : {}),
    ...extraEnv,
  }
  if (!providerUrl) { delete env.TRANSCRIBE_URL; delete env.TRANSCRIBE_KEY }
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  proc.stdout.on('data', (d) => log.push(String(d)))
  proc.stderr.on('data', (d) => log.push(String(d)))
  await waitForServer(`http://127.0.0.1:${port}/health`)
  return {
    port, dir, log,
    stop: async () => { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 200)); rmSync(dir, { recursive: true, force: true }) },
  }
}

export async function startRelay() {
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  return { port, stop: () => relay.close?.() }
}

export async function startVite(port, { relayPort, backupPort, publicDir } = {}) {
  const proc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: {
      ...process.env, TW_PORT: String(port),
      ...(relayPort ? { TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` } : {}),
      ...(backupPort ? { TW_BACKUP_PROXY: `http://127.0.0.1:${backupPort}` } : {}),
      ...(publicDir ? { TW_PUBLIC_DIR: publicDir } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${port}/`
  await waitForServer(base)
  return { base, stop: () => proc.kill('SIGTERM') }
}

/** A counter in the style of the other suites: PASS / FAIL lines, and the failure count at the end. */
export function checker() {
  const c = { failures: 0, passes: 0 }
  c.ok = (name, cond, detail = '') => {
    if (cond) { c.passes++; console.log(`  PASS  ${name}`) }
    else { c.failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
  }
  return c
}

export const record = (page, key = 'trustweb.v1.me') => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key)

export async function newPhone(browser, errors, { speech = false, viewport = { width: 430, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] })
  if (!speech) await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  page.on('dialog', (d) => void d.accept())
  return page
}

export async function startPhone(page, base, name) {
  await page.goto(base)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  // The phone-width demo-content offer, if it shows, is answered "no".
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

export async function launch() {
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  return engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
}
