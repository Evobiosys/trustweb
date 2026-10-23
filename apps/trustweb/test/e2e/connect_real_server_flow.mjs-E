/**
 * Wave 6b, V2 against the REAL connect service (services/trustweb-backup of the V1 branch, extracted from its commit into a scratch
 * directory: set TW_V1_SERVER to its server.mjs). Headless phones over a real test relay on the app origin (TLS front), the service
 * on loopback behind the same origin. No stub: the contract of section 10 as the client meets it.
 *   1  Ada's Meet mints a code on the real server; its 302 goes to her long link; the secret is stored as a hash (the file never holds it)
 *   2  Ada claims @ada in Advanced; /who/ada redirects to /c/<code>; a second claim of the same name by another code is a 409
 *   3  Bo adds "@ada", then the /c/ link of Cy, with the real two-hop redirect; the card opens, both phones are connected
 *   4  a new name updates the same code on the server; a phone opening /c/<code> afterwards sees the new name in the add sheet
 *   5  a forgotten code (the record's secret is wrong): the update is a 403, the phone mints a new code, and the address works again
 *   6  an unknown code and an unknown name are 404 "not available": the add sheet says the server does not know it
 * Ports: Vite 8983, TLS front 8984, service 8986.
 *   cd apps/demo && TW_V1_SERVER=<.../services/trustweb-backup/server.mjs> PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8983 ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_real_server_flow.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'

const PORT = Number(process.env.TW_PORT || 8983)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const SERVICE_PORT = Number(process.env.TW_SERVICE_PORT || 8986)
const SERVER = process.env.TW_V1_SERVER
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const t = tally()
const errors = []

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const appears = (locator, ms = 10_000) => locator.waitFor({ timeout: ms }).then(() => true, () => false)
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')

async function startService() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-connect-'))
  const env = {
    ...process.env, BACKUP_DIR: path.join(dir, 'backup'), PORT: String(SERVICE_PORT), HOST: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,${HOST}`, LINK_HOSTS: HOST, RATE_LIMIT: '5000',
    CONNECT_PER_MINUTE: '1000', CONNECT_PER_HOUR: '10000', CONNECT_GET_PER_MINUTE: '1000', CONNECT_GET_PER_HOUR: '10000',
  }
  for (const k of ['HOSTED_DIR', 'FEEDBACK_FILE', 'TRANSCRIBE_URL', 'TRANSCRIBE_KEY', 'LINKS_FILE', 'CONNECT_FILE']) delete env[k]
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  proc.stdout.on('data', (d) => log.push(String(d)))
  proc.stderr.on('data', (d) => log.push(String(d)))
  const t0 = Date.now()
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`)).status < 500) break } catch { /* not yet */ }
    if (Date.now() - t0 > 20_000) throw new Error('service did not start: ' + log.join(''))
    await new Promise((r) => setTimeout(r, 250))
  }
  return { dir, log, stop: async () => { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true }) } }
}

/** One GET to the service with the Host the proxy would send; no redirect followed. */
function rawGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: SERVICE_PORT, path: pathname, headers: { Host: HOST } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject); req.end()
  })
}

async function newPhone(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write', 'microphone'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
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
async function codeOf(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  return until(async () => {
    const rec = (await record(page)).connectCode
    return rec && (await payload(page)) === `${ORIGIN}/c/${rec.code}` ? rec.code : null
  }, 15_000)
}
async function openAdd(page) {
  await page.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
  await page.locator('.sheet.on [data-add-code]').waitFor({ timeout: 10_000 })
}

async function main() {
  if (!SERVER) throw new Error('set TW_V1_SERVER to the V1 services/trustweb-backup/server.mjs')
  const app = await startApp(PORT)
  const svc = await startService()
  const front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, servicePort: SERVICE_PORT, host: HOST })
  const browser = await launch([...front.browserArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
  try {
    console.log(`connect_real_server_flow: app ${app.base}, https front ${front.origin}, service :${SERVICE_PORT}`)
    // 1 mint
    const ada = await newPhone(browser)
    await startPhone(ada.page, 'Ada Lovelace')
    const code = await codeOf(ada.page)
    t.ok('1: the real server minted a code and the QR carries https://<host>/c/<22 chars>', !!code && /^[A-Za-z0-9_-]{22}$/.test(code), String(code))
    const rec = (await record(ada.page)).connectCode
    t.ok('1: the answer was read right: a 43 character secret and the long link kept', /^[A-Za-z0-9_-]{43}$/.test(rec.secret) && rec.url.includes('connect=did%3Apeer%3A2'))
    const red = await rawGet(`/c/${code}`)
    t.ok('1: GET /c/<code> is a 302 to Ada\'s long link, no-store', red.status === 302 && red.headers.location === rec.url && /no-store/.test(red.headers['cache-control'] ?? ''), JSON.stringify(red.headers).slice(0, 160))
    const file = readFileSync(path.join(svc.dir, 'backup', 'connect.json'), 'utf8')
    t.ok('1: the server file holds a hash, never the secret itself', !file.includes(rec.secret) && file.includes(code))

    // 2 claim
    await ada.page.locator('[data-act="advanced"]').click()
    await ada.page.locator('[data-username]').fill('@Ada')
    await ada.page.locator('[data-act="claim-name"]').click()
    t.ok('2: Ada claims @ada: "@ada is yours"', !!(await until(async () => /@ada is yours/.test(await ada.page.locator('[data-username-status]').innerText()))))
    const who = await rawGet('/who/ada')
    t.ok('2: GET /who/ada is a 302 to /c/<code> on the same host', who.status === 302 && who.headers.location === `${ORIGIN}/c/${code}`, JSON.stringify(who.headers.location))
    const cy = await newPhone(browser)
    await startPhone(cy.page, 'Cy Coder')
    const cyCode = await codeOf(cy.page)
    await cy.page.locator('[data-act="advanced"]').click()
    await cy.page.locator('[data-username]').fill('ada')
    await cy.page.locator('[data-act="claim-name"]').click()
    t.ok('2: Cy asking for the same name: "That name is taken" (409)', !!(await until(async () => /That name is taken/.test(await cy.page.locator('[data-username-status]').innerText()))))
    await cy.page.locator('[data-username]').fill('cyril')
    await cy.page.locator('[data-act="claim-name"]').click()
    t.ok('2: and a free name works', !!(await until(async () => /@cyril is yours/.test(await cy.page.locator('[data-username-status]').innerText()))))
    await cy.page.getByRole('button', { name: 'Back' }).click()

    // 3 Bo adds @ada, then Cy's /c/ link, through the real redirects
    const bo = await newPhone(browser)
    await startPhone(bo.page, 'Bo Builder')
    await openAdd(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill('@ada')
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('3: "@ada" resolves through /who/ and /c/ (two real 302s) and Ada\'s card opens', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Ada Lovelace' }), 15_000))
    t.ok('3: Ada\'s phone holds Bo', !!(await until(async () => (await record(ada.page)).peers.some((p) => p.displayName === 'Bo Builder'))))
    await bo.page.locator('.sheet.on .sheet-home').click()
    await openAdd(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(`${ORIGIN}/c/${cyCode}`)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('3: a pasted /c/ link adds Cy', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Cy Coder' }), 15_000))
    await bo.page.locator('.sheet.on .sheet-home').click()

    // 4 a new name updates the same code
    await ada.page.getByRole('button', { name: 'Back' }).click()
    await ada.page.getByRole('button', { name: 'Ada Lovelace' }).click()
    await ada.page.locator('.sheet input[aria-label="Your name"]').fill('Ada Byron')
    await ada.page.getByRole('button', { name: 'Save', exact: true }).click()
    t.ok('4: the stored link on the server changed, under the same code', !!(await until(async () => (await rawGet(`/c/${code}`)).headers.location?.includes('name=Ada+Byron'))))
    const dee = await newPhone(browser)
    await startPhone(dee.page, 'Dee Direct')
    await dee.page.goto(`${ORIGIN}/c/${code}`)
    t.ok('4: a phone opening the old /c/ link now sees Ada Byron in the add sheet', !!(await until(async () => (await dee.page.locator('.sheet.on [data-connect-add-name]').inputValue()) === 'Ada Byron', 20_000)))

    // 5 the server forgot the code: the secret on the phone is wrong
    await ada.page.evaluate(() => { const k = 'trustweb.v1.me'; const r = JSON.parse(localStorage.getItem(k)); r.connectCode.secret = 'x'.repeat(43); r.connectCode.updatedAt = 0; localStorage.setItem(k, JSON.stringify(r)) })
    await ada.page.reload()
    await ada.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await ada.page.locator('.hdr [aria-label^="Show my code"]').click()
    const code2 = await until(async () => { const r = (await record(ada.page)).connectCode; return r && r.code !== code && /^[A-Za-z0-9_-]{22}$/.test(r.code) ? r.code : null }, 15_000)
    t.ok('5: a 403 on the update makes the phone mint a new code, and the QR carries it', !!code2 && (await until(async () => (await payload(ada.page)) === `${ORIGIN}/c/${code2}`)))
    t.ok('5: the new address resolves', (await rawGet(`/c/${code2}`)).status === 302)

    // 6 unknown code, unknown name
    await openAdd(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill('A'.repeat(22))
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('6: an unknown code: the server\'s 404 becomes "does not know that code"', !!(await until(async () => /does not know that code/.test(await bo.page.locator('.sheet.on [data-add-code-status]').innerText()))))
    await bo.page.locator('.sheet.on [data-add-code]').fill('@nobody.here')
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('6: an unknown name: "does not know that name"', !!(await until(async () => /does not know that name/.test(await bo.page.locator('.sheet.on [data-add-code-status]').innerText()))))
    t.ok('6: the server\'s log names no code, name or url', !svc.log.join('').includes(code) && !svc.log.join('').includes('connect='))
    for (const p of [ada, cy, bo, dee]) await p.ctx.close()
  } finally {
    await browser?.close()
    await front?.stop()
    await svc?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nCONNECT REAL SERVER FLOW: ALL PASS' : `\nCONNECT REAL SERVER FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
