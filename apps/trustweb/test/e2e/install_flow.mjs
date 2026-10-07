/**
 * Install and demo-to-live (wave 1733, items 5 and 6 / amendments A2, A3):
 *   1. The manifest and its icons are served next to the app; the page links them.
 *   2. ?install=1 opens the Install sheet, also on a fresh phone (Start screen).
 *   3. Each way to install: the browser menu (headless Chromium never fires
 *      beforeinstallprompt), a one-tap prompt (a synthetic beforeinstallprompt
 *      stands in for Chromium's), iPhone steps (an iPhone user agent), and the
 *      storage warning BEFORE the steps when the browser already holds a web,
 *      already installed (navigator.standalone).
 *   4. Settings opens the same sheet.
 *   5. The demo page's ONE [Install] button runs demo-to-live (demo_flow part,
 *      see runDemoToLive below): start clean, keep them, and the existing-data case.
 *
 * Local only: Vite dev server (TW_PORT, default 5193) with the real backup
 * server behind /backup (TW_BACKUP_PORT, default 8967). TW_SHOTS=<dir> saves
 * screenshots at 390x844 and 1280x900.
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/install_flow.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const SERVER = path.resolve(TW_ROOT, '../../services/trustweb-backup/server.mjs')
const PORT = Number(process.env.TW_PORT || 5193)
const BACKUP_PORT = Number(process.env.TW_BACKUP_PORT || 8967)
const SHOTS = process.env.TW_SHOTS

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitFor(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]

async function start(page, base, name) {
  await page.goto(base)
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const noThanks = page.getByRole('button', { name: 'No thanks' })
  if (await noThanks.isVisible().catch(() => false)) await noThanks.click()
}

/** All TrustWeb records in this browser, by key. */
const records = (page) => page.evaluate(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k.startsWith('trustweb.')) out[k] = JSON.parse(localStorage.getItem(k))
  }
  return out
})

/** Opens the demo page, starts its first phone as `name` and adds one person of their own. */
async function demoWithOwnPerson(page, base, name, own) {
  await page.goto(base + 'demo/')
  const phone = page.frameLocator('iframe[title="Device 1"]')
  await phone.getByLabel('Your first name').fill(name)
  await phone.getByRole('button', { name: 'Start on this phone' }).click()
  await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const gotIt = phone.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()
  await phone.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
  await phone.getByPlaceholder('Name').first().fill(own)
  await phone.getByRole('button', { name: 'Add to my web' }).click()
  await phone.locator('.node', { hasText: own }).waitFor({ timeout: 5_000 })
  // its relay identity exists by now (minted when the phone started)
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.endsWith('.holder') && JSON.parse(localStorage.getItem(k)).identity), null, { timeout: 15_000 })
}

async function demoToLive(browser, base, shot, errors) {
  // A. start clean, nothing live yet
  const a = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pa = await a.newPage()
  pa.on('pageerror', (e) => errors.push(e.message))
  await demoWithOwnPerson(pa, base, 'Jakob', 'Max')
  const install = pa.locator('[data-demo-install]')
  ok('the demo page has ONE button top right: Install', await pa.locator('.demo-topbar button').count() === 1 && (await install.innerText()).trim() === 'Install')
  const box = await install.boundingBox()
  ok('it sits top right', box.x + box.width > 1280 - 120 && box.y < 80, JSON.stringify(box))
  await shot(pa, '05_demo_install_button')
  await pa.setViewportSize({ width: 1280, height: 900 })
  const demoRec = Object.entries(await records(pa)).find(([k]) => k.endsWith('.holder'))[1]
  await install.click()
  await pa.getByRole('dialog', { name: 'Make it your personal account' }).waitFor({ timeout: 5_000 })
  ok('Install reads "Make it your personal account" (wave 2, P12): nothing typed again; start clean / keep them', await pa.locator('[data-d2l="clean"]').isVisible() && await pa.locator('[data-d2l="keep"]').isVisible()
    && /Nothing needs to be typed again/.test(await pa.locator('.d2l').innerText()))
  await shot(pa, '06_demo_clean_question')
  await pa.setViewportSize({ width: 1280, height: 900 })
  await pa.locator('[data-d2l="clean"]').click()
  await pa.waitForURL((u) => u.pathname === '/' , { timeout: 15_000 })
  await pa.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await pa.locator('.sheet.on [data-install-path]').waitFor({ timeout: 10_000 })
  ok('then the live app opens with the Install sheet (?install=1)', true)
  const liveA = (await records(pa))['trustweb.v1.me']
  ok('"Start clean": the live web has their name and their own person only', liveA?.me.displayName === 'Jakob' && JSON.stringify(liveA.people.map((p) => p.name)) === '["Max"]', JSON.stringify(liveA?.people.map((p) => p.name)))
  ok('no demo identity, id or peer came along (the live app has its own)', liveA.me.id !== demoRec.me.id && liveA.peers.length === 0
    && (!liveA.identity || JSON.stringify(liveA.identity) !== JSON.stringify(demoRec.identity)) && liveA.people.every((p) => !p.peerId))
  ok('the carry-over record is used up', !('trustweb.carry.v1' in await records(pa)))
  ok('the demo phone itself is untouched', JSON.stringify(Object.entries(await records(pa)).find(([k]) => k.endsWith('.holder'))[1].me) === JSON.stringify(demoRec.me))
  await shot(pa, '07_live_after_clean')
  await a.close()

  // B. keep them: the dummy friends come along, still saying dummy
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pb = await b.newPage()
  pb.on('pageerror', (e) => errors.push(e.message))
  await demoWithOwnPerson(pb, base, 'Jakob', 'Max')
  await pb.locator('[data-demo-install]').click()
  await pb.locator('[data-d2l="keep"]').click()
  await pb.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const liveB = (await records(pb))['trustweb.v1.me']
  ok('"Keep them": the imaginary friends come along with their own person', liveB.people.length === 7 && liveB.people.some((p) => p.name === 'Max'), String(liveB.people.length))
  await pb.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  ok('and still say dummy (Max does not)', await pb.locator('.node .dummy-chip').count() === 6 && await pb.locator('.node', { hasText: 'Max' }).locator('.dummy-chip').count() === 0)
  await shot(pb, '08_live_after_keep')
  await b.close()

  // C. the live app already has people: merge on a yes, never overwrite; D. cancel adds nothing
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pc = await c.newPage()
  pc.on('pageerror', (e) => errors.push(e.message))
  await start(pc, base, 'Jakob P.')
  await pc.locator('.rings-wrap').click({ position: { x: 176 + 114, y: 176 } })
  await pc.getByPlaceholder('Name').first().fill('Ben')
  await pc.getByRole('button', { name: 'Add to my web' }).click()
  const before = (await records(pc))['trustweb.v1.me']
  await demoWithOwnPerson(pc, base, 'Jakob', 'Max')
  await pc.locator('[data-demo-install]').click()
  await pc.locator('[data-d2l="clean"]').click()
  await pc.getByRole('heading', { name: 'Bring your demo along?' }).waitFor({ timeout: 15_000 })
  ok('live app with people: it says so and asks merge or cancel', /already has 1 person/.test(await pc.locator('.sheet').innerText()) && await pc.locator('[data-carry="merge"]').isVisible() && await pc.locator('[data-carry="cancel"]').isVisible())
  ok('nothing is written before the answer', JSON.stringify((await records(pc))['trustweb.v1.me']) === JSON.stringify(before))
  await shot(pc, '09_live_merge_question')
  await pc.setViewportSize({ width: 390, height: 844 })
  await pc.locator('[data-carry="merge"]').click()
  await pc.locator('.sheet.on [data-install-path]').waitFor({ timeout: 10_000 })
  const merged = (await records(pc))['trustweb.v1.me']
  ok('merge: Ben stays, Max joins, the live name and identity stay', JSON.stringify(merged.people.map((p) => p.name).sort()) === '["Ben","Max"]' && merged.me.displayName === 'Jakob P.' && merged.me.id === before.me.id && JSON.stringify(merged.identity) === JSON.stringify(before.identity))
  ok('then the Install sheet', true)
  // D. once more from the demo, and cancel this time
  await pc.goto(base + 'demo/')
  await pc.locator('[data-demo-install]').click()
  await pc.locator('[data-d2l="keep"]').click()
  await pc.getByRole('heading', { name: 'Bring your demo along?' }).waitFor({ timeout: 15_000 })
  await pc.locator('[data-carry="cancel"]').click()
  const after = (await records(pc))['trustweb.v1.me']
  ok('cancel: nothing from the demo is added, the record is used up', JSON.stringify(after.people.map((p) => p.name).sort()) === '["Ben","Max"]' && !('trustweb.carry.v1' in await records(pc)))
  await c.close()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-install-'))
  const backupProc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, BACKUP_DIR: dir, PORT: String(BACKUP_PORT), HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_BACKUP_PROXY: `http://127.0.0.1:${BACKUP_PORT}`, TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitFor(base)
  await waitFor(`http://127.0.0.1:${BACKUP_PORT}/`)
  console.log('install-flow against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  const shot = async (page, name) => {
    if (!SHOTS) return
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.width, height: s.height })
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
    }
  }
  try {
    browser = await engine.launch({ headless: true })
    const errors = []

    // 1. manifest and icons
    const manifest = await (await fetch(base + 'manifest.json')).json()
    ok('the manifest is served next to the app: TrustWeb, standalone', manifest.name === 'TrustWeb' && manifest.display === 'standalone' && manifest.start_url === './')
    const icons = await Promise.all(manifest.icons.map(async (i) => (await fetch(base + i.src)).headers.get('content-type')))
    ok('every icon the manifest names is served as a PNG', icons.every((t) => t === 'image/png'), JSON.stringify(icons))

    // 2. ?install=1 on a fresh phone: the sheet over the Start screen; headless Chromium = the menu path
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(base + '?install=1')
    await page.locator('.sheet.on').getByRole('heading', { name: 'Install TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('?install=1 opens the Install sheet on a fresh phone (Start screen under it)', await page.getByRole('button', { name: 'Start on this phone' }).count() === 1)
    ok('headless Chromium (no install prompt): the browser menu, said plainly', await page.locator('[data-install-path="menu"]').isVisible() && /Install app/.test(await page.locator('.sheet').innerText()))
    ok('the page links the manifest and the Apple touch icon', await page.locator('link[rel="manifest"][href$="manifest.json"]').count() === 1 && await page.locator('link[rel="apple-touch-icon"]').count() === 1)
    ok('the query string is consumed (a reload does not reopen the sheet)', new URL(page.url()).search === '')
    await shot(page, '01_install_menu_fresh')

    // 3a. a one-tap prompt: a synthetic beforeinstallprompt stands in for Chromium's
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true })
      e.prompt = async () => { window.__prompted = true }
      e.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(e)
    })
    await page.locator('[data-install-path="prompt"]').waitFor({ timeout: 5_000 })
    ok('when the prompt arrives, the open sheet switches to one Install button', true)
    await shot(page, '02_install_prompt')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-install-path="prompt"]').click()
    await page.locator('.toast.on', { hasText: 'Installed' }).waitFor({ timeout: 5_000 })
    ok('Install raises the browser prompt and says what happened', await page.evaluate(() => window.__prompted === true))
    await ctx.close()

    // 3b. iPhone, fresh: the steps, no storage warning (nothing to move)
    const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true })
    const ip = await ios.newPage()
    ip.on('pageerror', (e) => errors.push(e.message))
    await ip.goto(base + '?install=1')
    await ip.locator('[data-install-path="ios"]').waitFor({ timeout: 15_000 })
    ok('iPhone: the "Share > Add to Home Screen" steps', /Add to Home Screen/.test(await ip.locator('.sheet').innerText()) && await ip.locator('.install-steps li').count() === 3)
    ok('iPhone, nothing stored yet: no storage warning', await ip.locator('[data-install-move]').count() === 0)
    // 3c. iPhone with a web in this browser: the warning comes BEFORE the steps, with the backup to move it
    await ip.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await start(ip, base, 'Ines')
    await ip.locator('.rings-wrap').click({ position: { x: 176 + 114, y: 176 } })
    await ip.getByPlaceholder('Name').first().fill('Lena')
    await ip.getByRole('button', { name: 'Add to my web' }).click()
    await ip.goto(base + '?install=1')
    await ip.locator('[data-install-move]').waitFor({ timeout: 15_000 })
    const order = await ip.evaluate(() => {
      const m = document.querySelector('[data-install-move]')
      const st = document.querySelector('.install-steps')
      return Boolean(m && st && (m.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING))
    })
    ok('iPhone with a web here: "your web stays in this browser" comes before the steps', order && /separate from this browser/.test(await ip.locator('[data-install-move]').innerText()))
    await ip.getByRole('button', { name: 'Back up first' }).waitFor({ timeout: 10_000 })
    ok('it offers the backup to move the web (backup server reachable)', true)
    await shot(ip, '03_install_ios_move')
    await ip.setViewportSize({ width: 390, height: 844 })
    await ip.getByRole('button', { name: 'Back up first' }).click()
    await ip.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 5_000 })
    ok('"Back up first" leads to the backup card in Inventory', await ip.getByText('Do you want to back it up on a Swiss server?').isVisible())
    await ios.close()

    // 3d. already installed (running from the home screen)
    const inst = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE })
    await inst.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }))
    const ins = await inst.newPage()
    await ins.goto(base + '?install=1')
    await ins.locator('[data-install-path="installed"]').waitFor({ timeout: 15_000 })
    ok('already installed: says so', /is installed/.test(await ins.locator('.sheet').innerText()))
    await inst.close()

    // 4. Settings > Install
    const sctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const sp = await sctx.newPage()
    sp.on('pageerror', (e) => errors.push(e.message))
    await start(sp, base, 'Sara')
    await sp.getByRole('button', { name: 'More' }).click()
    await sp.locator('.menu-item', { hasText: 'Settings' }).click()
    const about = await sp.locator('.about-link').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    ok('Settings > About links FAQ, Feedback, Privacy, Imprint on the website', JSON.stringify(about) === JSON.stringify(['faq', 'feedback', 'privacy', 'imprint'].map((p) => `https://idea2.site/trustweb/${p}.html`)), JSON.stringify(about))
    ok('"TrustWeb, by EvoBioSys" links EvoBioSys', /TrustWeb, by EvoBioSys/.test(await sp.locator('.about-by').innerText()) && await sp.locator('.about-org').getAttribute('href') === 'https://evobiosys.org/')
    await sp.locator('.about-links').scrollIntoViewIfNeeded()
    await shot(sp, '04_settings_about_install')
    await sp.setViewportSize({ width: 390, height: 844 })
    await sp.locator('[data-open-install]').click()
    await sp.locator('.sheet.on [data-install-path]').waitFor({ timeout: 5_000 })
    ok('Settings opens the Install sheet', true)
    await sctx.close()

    // 5. the demo page's ONE [Install] button: demo to live
    await demoToLive(browser, base, shot, errors)

    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    backupProc.kill()
    await relay.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\ninstall-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
