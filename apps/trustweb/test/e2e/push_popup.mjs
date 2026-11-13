// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 push-popup, 360 px and 1280 px (stock): seed two unseen notifications into the local inbox, load the app: the popup is there,
 * a tap outside and Escape do nothing, the X sits clear of the title and rows, X closes, a reload shows nothing. An item tap marks only
 * that item. The setting off keeps the popup away. TW_SHOTS=<dir> keeps screenshots.
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<repo>/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs npx tsx ../trustweb/test/e2e/push_popup.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.TW_PORT || 5413)
const SHOTS = process.env.TW_SHOTS || path.resolve(TW_ROOT, '../../DEVLOG/wave42/screens')
let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}
async function waitFor(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { await fetch(url); return } catch { /* not up */ } await new Promise((r) => setTimeout(r, 300)) }
  throw new Error('server did not come up: ' + url)
}
const miss = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

/** Writes two unseen items to the inbox store the way the worker does. */
const seed = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('trustweb-inbox', 1)
  req.onupgradeneeded = () => { req.result.createObjectStore('items', { keyPath: 'id' }) }
  req.onerror = () => reject(req.error)
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('items', 'readwrite')
    const now = Date.now()
    tx.objectStore('items').put({ id: 'i1', kind: 'chat', title: 'TrustWeb', body: 'Ada sent you a message.', at: now - 60_000, seenAt: null })
    tx.objectStore('items').put({ id: 'i2', kind: 'connect', title: 'TrustWeb', body: 'Someone wants to connect.', at: now - 30_000, seenAt: null })
    tx.oncomplete = () => { db.close(); resolve(true) }
  }
}))

async function run(browser, base, width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  // the dev preview panel is not part of the app
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok { display: none !important }'; document.head.append(st) }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // a cold dev server may reload the page once while it optimises: start again until the record is stored
  for (let i = 0; i < 6 && !(await page.evaluate(() => localStorage.getItem('trustweb.v1.me')).catch(() => null)); i++) {
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Test')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.waitForFunction(() => localStorage.getItem('trustweb.v1.me'), null, { timeout: 8_000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  ok(`${tag}: no popup with an empty inbox`, (await page.locator('[data-missed-popup]').count()) === 0)
  await seed(page)
  await page.reload()
  await page.locator('[data-missed-popup]').waitFor({ timeout: 10_000 })
  ok(`${tag}: popup lists both, newest first`, JSON.stringify(await page.locator('[data-missed-row]').evaluateAll((n) => n.map((x) => x.dataset.missedRow))) === '["i2","i1"]')
  await page.screenshot({ path: path.join(SHOTS, `push-popup-${width}.png`) })
  // tap outside: nothing; Escape: nothing
  await page.mouse.click(3, 3)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  ok(`${tag}: tap outside and Escape keep it open`, (await page.locator('[data-missed-popup]').count()) === 1)
  // P06: the X overlays neither the title nor a row
  const x = await page.locator('[data-missed-close]').boundingBox()
  const parts = [await page.locator('#missed-title').boundingBox(), ...await page.locator('[data-missed-row] .missed-open').evaluateAll((n) => n.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))]
  ok(`${tag}: X overlaps no text`, parts.every((p) => miss(x, p)), JSON.stringify({ x, parts }))
  const pop = await page.locator('.missed-panel').boundingBox()
  ok(`${tag}: panel inside the screen, no sideways scroll`, pop.x >= 0 && pop.x + pop.width <= width && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.locator('[data-missed-close]').click()
  ok(`${tag}: X closes`, (await page.locator('[data-missed-popup]').count()) === 0)
  await page.waitForTimeout(400)
  await page.reload()
  await page.locator('.hdr').first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(800)
  ok(`${tag}: reload shows nothing`, (await page.locator('[data-missed-popup]').count()) === 0)
  // one item: opening it marks only that one
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('trustweb-inbox', 1); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); const n = Date.now(); tx.objectStore('items').put({ id: 'j1', kind: 'chat', title: 'T', body: 'one', at: n - 2, seenAt: null }); tx.objectStore('items').put({ id: 'j2', kind: 'chat', title: 'T', body: 'two', at: n - 1, seenAt: null }); tx.oncomplete = () => { r.result.close(); res(true) } } }))
  await page.reload()
  await page.locator('[data-missed-row="j1"] .missed-open').click()
  await page.waitForTimeout(800)
  ok(`${tag}: opening an item closes the popup`, (await page.locator('[data-missed-popup]').count()) === 0)
  await page.reload()
  await page.locator('[data-missed-row="j2"]').waitFor({ timeout: 10_000 })
  ok(`${tag}: only the opened item was marked`, (await page.locator('[data-missed-row]').count()) === 1)
  await page.locator('[data-missed-close]').click()
  await page.waitForTimeout(400)
  // the setting off: the popup stays away
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('trustweb-inbox', 1); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); tx.objectStore('items').put({ id: 'k1', kind: 'chat', title: 'T', body: 'k', at: Date.now(), seenAt: null }); tx.oncomplete = () => { r.result.close(); res(true) } } }))
  await page.evaluate(() => { localStorage.setItem('trustweb.ui.settings.advanced', '1'); localStorage.setItem('trustweb.ui.settings.notifications', '1') })
  await page.locator('nav.tabs button', { hasText: 'Resources' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('[data-missed-setting]').waitFor({ state: 'attached' })
  await page.evaluate(() => { for (let d = document.querySelector('[data-missed-setting]').parentElement; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true })
  await page.locator('[data-missed-setting]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, `push-popup-settings-${width}.png`) })
  await page.locator('[data-missed-setting]').click()
  await page.waitForTimeout(400)
  await page.reload()
  await page.waitForTimeout(1000)
  ok(`${tag}: setting off keeps the popup away`, (await page.locator('[data-missed-popup]').count()) === 0)
  ok(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const viteProc = spawn(process.execPath, [path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort'], { cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  const base = `http://127.0.0.1:${PORT}/`
  let browser = null
  try {
    await waitFor(base)
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    browser = await (pw.chromium ? pw : pw.default).chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
    await run(browser, base, 360, 780, '360')
    await run(browser, base, 1280, 900, '1280')
  } finally {
    await browser?.close()
    viteProc.kill()
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed')
  process.exit(failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
