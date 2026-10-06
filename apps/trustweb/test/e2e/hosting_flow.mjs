/**
 * Recordings hosted on the Swiss server (wave 1733 round B, item 4), against
 * the LOCAL Swiss server with the real free allowance (36000 s):
 *   1. Off by default; switched on, the kept recordings go up sealed (the
 *      server holds bytes that are not WebM), the bar shows hours used of 10.
 *   2. At the allowance (the account prefilled through the API with long
 *      declared recordings and tiny bodies): the next recording gets the
 *      plain message and "Tell us what would be fair", and stays on the phone.
 *   3. Remove one from the server: it stays on the phone.
 *   4. A restored phone (the record without the audio): a hosted recording is
 *      fetched back and plays again.
 * Ports: Vite 5297, Swiss server 5294. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/hosting_flow.mjs
 */
import { hkdfSync, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startSwissServer, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const SWISS = 5294

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
/** The hosted account exactly as the phone derives it (HKDF-SHA256, empty salt, the contract's info strings). */
const derive = (secret, info) => Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'hex'), Buffer.alloc(0), info, 32)).toString('hex')
const accountOf = (secret) => ({ account: derive(secret, 'trustweb-hosted/v1/account'), token: derive(secret, 'trustweb-hosted/v1/token') })
const api = (p, init = {}) => fetch(`http://127.0.0.1:${SWISS}${p}`, { ...init, headers: { Host: '127.0.0.1', ...(init.headers ?? {}) } })

async function openSettings(page) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.getByRole('button', { name: 'More' }).click()
  await page.locator('.menu-item', { hasText: 'Settings' }).click()
  await page.locator('[data-hosting-toggle]').waitFor({ timeout: 10_000 })
}
async function saveMemo(page, what) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.about-kind.what').click()
  await page.getByLabel('What was this about?').fill(what)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(2_300)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
}
const meetingId = async (page, about) => (await record(page)).meetings.find((m) => m.about === about)?.id

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const swiss = await startSwissServer(SWISS)
  const relay = await startRelay()
  const vite = await startVite(5297, { relayPort: relay.port, backupPort: SWISS })
  let browser = null
  try {
    browser = await launch()
    const page = await newPhone(browser, errors)
    await startPhone(page, vite.base, 'Jakob')
    await saveMemo(page, 'Bike')
    await saveMemo(page, 'Drill')

    // 1. off by default, then on
    await openSettings(page)
    ok('Settings: "Hosted on the Swiss server" is there and OFF by default', (await page.locator('[data-hosting-toggle]').getAttribute('aria-pressed')) === 'false' && !(await record(page)).hosting)
    await shot(page, '10-hosting-off-by-default')
    const toServer = []
    page.on('request', (r) => { if (/\/hosted\/(?!status)/.test(r.url())) toServer.push(r.method() + ' ' + r.url()) })
    // review-app-b: switching on asks first and names what goes up; nothing is made or sent before the yes
    await page.locator('[data-hosting-toggle]').click()
    await page.locator('.sheet.on [data-hosting-confirm]').waitFor({ timeout: 10_000 })
    const confirmText = await page.locator('.sheet.on').innerText()
    ok('switching on asks first, naming what goes up now (2 recordings: Bike, Drill)', (await page.locator('.sheet.on [data-hosting-confirm]').getAttribute('data-hosting-confirm')) === '2'
      && /Bike/.test(confirmText) && /Drill/.test(confirmText) && /sealed on this phone/i.test(confirmText), confirmText)
    await shot(page, '10b-hosting-confirm')
    await page.locator('.sheet.on [data-hosting-confirm-no]').click()
    await page.locator('[data-hosting-toggle]').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(500)
    ok('"Not now": still off, no hosted account made, nothing sent to the server', (await page.locator('[data-hosting-toggle]').getAttribute('aria-pressed')) === 'false' && !(await record(page)).hosting && toServer.length === 0, toServer.join(' | '))
    await page.locator('[data-hosting-open]').click()
    await page.locator('.sheet.on .host-list').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(800)
    ok('looking at the hosted recordings while off asks nothing of the server and makes no account', !(await record(page)).hosting && toServer.length === 0, toServer.join(' | '))
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await openSettings(page)
    await page.locator('[data-hosting-toggle]').click()
    await page.locator('.sheet.on [data-hosting-confirm-yes]').click()
    const hosted = await until(async () => { const h = (await record(page)).hosting; return h?.on && h.recs.length === 2 ? h : null })
    ok('switched on: both kept recordings are hosted', Boolean(hosted))
    const { account, token } = accountOf(hosted.secret)
    const list = await (await api(`/hosted/${account}/recs`, { headers: { 'X-Write-Token': token } })).json()
    ok('the server lists them under the hosted account', list.recordings.length === 2)
    const one = Buffer.from(await (await api(`/hosted/${account}/rec/${hosted.recs[0].rid}`, { headers: { 'X-Write-Token': token } })).arrayBuffer())
    ok('what the server stores is sealed (not WebM: no EBML header; version byte 1)', one[0] === 1 && one.indexOf(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) === -1)
    await page.locator('[data-hosting-usage]').waitFor({ timeout: 10_000 })
    ok('the bar shows hours used of 10', /0\.00 of 10 hours used/.test(await page.locator('.sheet.on .usage').innerText()))
    const persist = await page.locator('[data-audio-kept]').getAttribute('data-persist')
    ok('Settings says honestly whether the browser keeps the storage (persist asked)', persist === 'granted' || persist === 'not-granted', persist)
    await shot(page, '11-hosting-on-usage')

    // 2. at the allowance
    const usage0 = await (await api(`/hosted/${account}/usage`, { headers: { 'X-Write-Token': token } })).json()
    const fill = async (seconds) => {
      const rid = randomBytes(16).toString('hex')
      const r = await api(`/hosted/${account}/rec/${rid}`, { method: 'PUT', headers: { 'X-Write-Token': token, 'X-Seconds': String(seconds), 'Content-Type': 'application/octet-stream' }, body: randomBytes(64) })
      return r.status
    }
    let left = usage0.secondsLimit - usage0.secondsUsed - 1
    let fills = 0
    while (left > 0) { const s = Math.min(3600, left); if (await fill(s) !== 204) break; left -= s; fills++ }
    const usage1 = await (await api(`/hosted/${account}/usage`, { headers: { 'X-Write-Token': token } })).json()
    ok(`the account is one second short of the allowance (${fills} long recordings declared through the API)`, usage1.secondsUsed === usage1.secondsLimit - 1, JSON.stringify(usage1))
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await saveMemo(page, 'Ladder')
    await page.locator('.toast.on', { hasText: 'free 10 hours' }).waitFor({ timeout: 20_000 })
    ok('the next recording: "your free 10 hours are used, the rest stays on this phone"', true)
    const ladder = await meetingId(page, 'Ladder')
    ok('it stays on this phone, not hosted', !(await record(page)).hosting.recs.some((r) => r.meetingId === ladder) && await page.evaluate(async (id) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('trustweb-audio.me', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      return new Promise((res) => { const g = db.transaction('audio').objectStore('audio').get(id); g.onsuccess = () => res(Boolean(g.result)) })
    }, ladder))
    await openSettings(page)
    await page.locator('[data-hosting-open]').click()
    await page.locator('.sheet.on [data-hosting-allowance]').waitFor({ timeout: 10_000 })
    const msg = await page.locator('.sheet.on [data-hosting-allowance]').innerText()
    ok('the sheet: the plain allowance message, nothing lost, pricing experimental', /used the free 10 hours/.test(msg) && /nothing is lost/.test(msg) && /experimental/.test(msg), msg)
    ok('"Tell us what would be fair" goes to the feedback page', /feedback\.html$/.test(await page.locator('.sheet.on [data-hosting-allowance] a').getAttribute('href')))
    await until(async () => (await page.locator(`.sheet.on [data-host-row="${ladder}"]`).count()) === 1, 10_000)
    ok('the bar is full and the recording reads "on this phone only"', /10\.00 of 10 hours used/.test(await page.locator('.sheet.on .usage').innerText()) && (await page.locator(`.sheet.on [data-host-row="${ladder}"]`).getAttribute('data-host-state')) === 'phone')
    await shot(page, '12-hosting-allowance-reached')
    await until(async () => (await page.locator('.sheet.on [data-host-unknown]').count()) === fills, 10_000)
    ok(`what the server holds that this phone does not know is listed, removable (${fills})`, await page.locator('.sheet.on [data-host-unknown]').count() === fills)
    const stray = await page.locator('.sheet.on [data-host-unknown]').first().getAttribute('data-host-unknown')
    await page.locator(`.sheet.on [data-unhost-unknown="${stray}"]`).click()
    await until(async () => (await page.locator('.sheet.on [data-host-unknown]').count()) === fills - 1, 15_000)
    const listU = await (await api(`/hosted/${account}/recs`, { headers: { 'X-Write-Token': token } })).json()
    ok('"Remove from the server" on such a one deletes it there (the list shows the server\'s truth)', !listU.recordings.some((r) => r.id === stray) && await page.locator('.sheet.on [data-host-unknown]').count() === fills - 1)

    // 3. remove one from the server
    const bike = await meetingId(page, 'Bike')
    await page.locator(`.sheet.on [data-unhost="${bike}"]`).click()
    await until(async () => (await page.locator(`.sheet.on [data-host-row="${bike}"]`).getAttribute('data-host-state')) === 'phone', 15_000)
    const list2 = await (await api(`/hosted/${account}/recs`, { headers: { 'X-Write-Token': token } })).json()
    ok('removed from the server, still on this phone', (await page.locator(`.sheet.on [data-host-row="${bike}"]`).getAttribute('data-host-state')) === 'phone' && !list2.recordings.some((r) => r.id === hosted.recs.find((x) => x.meetingId === bike)?.rid))

    // 4. a restored phone: the record (it rides in the backup) without the audio
    const saved = await page.evaluate(() => localStorage.getItem('trustweb.v1.me'))
    const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 } })
    const p2 = await ctx2.newPage()
    p2.on('pageerror', (e) => errors.push(e.message))
    await p2.route(vite.base + 'seed-blank', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
    await p2.goto(vite.base + 'seed-blank')
    await p2.evaluate((v) => localStorage.setItem('trustweb.v1.me', v), saved)
    await p2.goto(vite.base)
    await p2.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await openSettings(p2)
    await p2.locator('[data-hosting-open]').click()
    const drill = await meetingId(p2, 'Drill')
    await until(async () => (await p2.locator(`.sheet.on [data-host-row="${drill}"]`).getAttribute('data-host-state')) === 'server', 15_000)
    ok('a restored phone sees the hosted recording "only on the Swiss server"', (await p2.locator(`.sheet.on [data-host-row="${drill}"]`).getAttribute('data-host-state')) === 'server')
    await shot(p2, '13-restored-phone-fetch-back')
    await p2.locator(`.sheet.on [data-fetch="${drill}"]`).click()
    await until(async () => (await p2.locator(`.sheet.on [data-host-row="${drill}"]`).getAttribute('data-host-state')) === 'both', 15_000)
    ok('"Get it back onto this phone": it is on both again', (await p2.locator(`.sheet.on [data-host-row="${drill}"]`).getAttribute('data-host-state')) === 'both')
    await p2.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await p2.locator('nav.tabs .tab-record').click()
    await p2.locator('.past-link').click()
    await p2.locator('.pm-row', { hasText: 'Drill' }).click()
    await p2.locator('.sheet.on .pm-player').waitFor({ timeout: 10_000 })
    ok('and the meeting plays again on the restored phone', await p2.locator('.sheet.on .pm-player').count() === 1)
    await ctx2.close()

    // off again
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await openSettings(page)
    await page.locator('[data-hosting-toggle]').click()
    ok('switched off: nothing new goes up (the recordings there stay until removed)', (await record(page)).hosting.on === false)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await swiss.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nhosting-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
