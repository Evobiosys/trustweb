/**
 * Headless run of Settings > Tab bar (Always / Show on hover / Hidden) at 390x812: starts the Vite dev server, checks the bar
 * slides off and back, the Hidden return-to-People path, and that no request leaves 127.0.0.1. Kills the server it started.
 *
 * Run from apps/crm:  CRM_PORT=5198 node test/e2e/tabbar.mjs   (screenshots to test/e2e/shots/, or CRM_SHOTS=/dir)
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.CRM_PORT || 5198)
const SHOTS = process.env.CRM_SHOTS || path.join(HERE, 'shots')
const APP = `http://127.0.0.1:${PORT}/`

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error(`dev server not reachable at ${url}`)
}

mkdirSync(SHOTS, { recursive: true })
const server = spawn(path.join(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CRM_PORT: String(PORT) },
})
server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`))

let browser
try {
  await waitForServer(APP)
  browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 812 }, deviceScaleFactor: 2, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  const outside = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()) })
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  const rect = () => page.locator('.tabbar').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight } })
  const setMode = async (mode) => {
    await page.click('[data-tab="settings"]')
    await page.check(`[data-field="tabbar"][value="${mode}"]`)
  }

  await page.goto(APP)
  await page.waitForSelector('[data-screen="people"]')
  let r = await rect()
  ok('always: bar on screen', r.bottom <= r.vh && (await page.locator('.tabbar-hotzone').count()) === 0)

  await setMode('hover')
  await sleep(300)
  r = await rect()
  ok('hover: bar off-screen', r.top >= r.vh, JSON.stringify(r))
  await shot('tabbar_hover_hidden')
  ok('hover: header gear still reachable', (await page.locator('[data-tab="settings"]').count()) === 1)

  const zone = await page.locator('[data-part="tabbar-hotzone"]').boundingBox()
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2)
  await sleep(250)
  r = await rect()
  ok('hover: hot zone brings the bar back', r.bottom <= r.vh, JSON.stringify(r))
  await shot('tabbar_hover_shown')

  await page.mouse.move(195, 300)
  await sleep(700 + 250)
  r = await rect()
  ok('hover: bar re-hides 700 ms after leave', r.top >= r.vh, JSON.stringify(r))

  // A mouse click on a tab focuses it (Chromium): the bar still leaves once the pointer is gone (only keyboard focus keeps it).
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2)
  await sleep(250)
  await page.locator('.tab').first().click()
  await page.mouse.move(195, 300)
  await sleep(700 + 250)
  r = await rect()
  ok('hover: bar leaves after a tab was clicked', r.top >= r.vh, JSON.stringify(r))

  await page.keyboard.press('Tab')
  await page.locator('.tab').first().focus()
  await sleep(250)
  r = await rect()
  ok('hover: focusing a tab shows the bar', r.bottom <= r.vh, JSON.stringify(r))
  await page.locator('.tab').first().blur()

  await setMode('hidden')
  ok('hidden: no .tabbar in the DOM', (await page.locator('.tabbar').count()) === 0 && (await page.locator('.tabbar-hotzone').count()) === 0)
  const pad = await page.locator('main').evaluate((el) => getComputedStyle(el).paddingBottom)
  ok('hidden: no dead band under main', pad === '24px', pad)
  await shot('tabbar_hidden')
  await page.click('[data-tab="settings"]')
  await page.waitForSelector('[data-screen="people"]')
  ok('hidden: header icon on its own page returns to People', (await page.locator('[data-screen="people"]').count()) === 1)

  await page.click('[data-tab="settings"]')
  await page.check('[data-field="tabbar"][value="always"]')
  r = await rect()
  ok('always: back, bar on screen', r.bottom <= r.vh)

  ok('privacy line visible in every mode', (await page.locator('.privacy').isVisible()))
  ok('no request leaves 127.0.0.1', outside.length === 0, outside.join(' | '))
  ok('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  failures++
  console.log(`  FAIL  run aborted  ->  ${e?.stack || e}`)
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
console.log(`screenshots: ${SHOTS}`)
process.exit(failures ? 1 : 0)
