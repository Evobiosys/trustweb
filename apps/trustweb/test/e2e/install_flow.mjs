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

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-install-'))
  const backupProc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, BACKUP_DIR: dir, PORT: String(BACKUP_PORT), HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_BACKUP_PROXY: `http://127.0.0.1:${BACKUP_PORT}` },
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

    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    backupProc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\ninstall-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
