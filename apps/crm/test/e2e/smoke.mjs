/**
 * Headless smoke run: starts the Vite dev server, opens the CRM in a phone
 * viewport, walks People -> person -> Timeline -> Pipeline -> Follow-ups,
 * adds an interaction and a follow-up, checks they persist across a reload,
 * and writes screenshots. Exits non-zero on any failed check. Kills the
 * server it started.
 *
 * Run from apps/crm:
 *   node test/e2e/smoke.mjs                      (screenshots to test/e2e/shots/)
 *   CRM_SHOTS=/some/dir node test/e2e/smoke.mjs  (screenshots elsewhere)
 *
 * Browsers come from the local Playwright cache (PLAYWRIGHT_BROWSERS_PATH in
 * ~/.claude/settings.json); playwright-core never downloads one.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.CRM_PORT || 5196)
const SHOTS = process.env.CRM_SHOTS || path.join(HERE, 'shots')
const URL = `http://127.0.0.1:${PORT}/`

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
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
  await waitForServer(URL)
  browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 812 }, deviceScaleFactor: 2, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

  await page.goto(URL)
  await page.waitForSelector('[data-screen="people"]')
  ok('people list renders sample data', (await page.locator('.person-row').count()) === 7)
  ok('source line says sample', (await page.locator('.source').innerText()).includes('Sample'))
  await shot('01-people')

  await page.fill('input[type="search"]', 'graz')
  ok('search narrows to Tomás', (await page.locator('.person-row').count()) === 1)
  await page.fill('input[type="search"]', '')

  await page.locator('.person-row', { hasText: 'Lena Hofbauer' }).click()
  await page.waitForSelector('[data-screen="person"]')
  ok('person header', (await page.locator('h2').innerText()).includes('Lena Hofbauer'))
  ok('contact info collapsed shows known channels only', (await page.locator('.contact-row').count()) === 4)
  await page.click('.contact-more')
  ok('contact info expands to every channel', (await page.locator('.contact-row').count()) >= 8)
  ok('person timeline has events', (await page.locator('[data-screen="person"] .event').count()) >= 5)
  await shot('02-person')

  await page.click('[data-action="add-interaction"]')
  await page.fill('[data-field="interaction-text"]', 'Walked the Donaukanal, she will ask Benedikt')
  await page.click('[data-action="save-interaction"]')
  ok('interaction appears on the timeline', await page.locator('.event', { hasText: 'Donaukanal' }).count() === 1)

  await page.click('[data-action="log-now-call"]')
  ok('one-tap log adds a call', await page.locator('.event', { hasText: 'Had a call' }).count() === 1)

  await page.click('[data-action="add-followup"]')
  await page.fill('[data-field="followup-text"]', 'Send the association statutes')
  await page.click('[data-action="save-followup"]')
  ok('follow-up appears on the timeline', await page.locator('.event', { hasText: 'statutes' }).count() === 1)
  await shot('03-person-after-add')

  await page.click('[data-tab="timeline"]')
  await page.waitForSelector('[data-screen="timeline"]')
  const dates = await page.locator('[data-screen="timeline"] .event').evaluateAll((els) => els.map((e) => Number(e.dataset.at)))
  ok('timeline is newest first', dates.length > 10 && dates.every((d, i) => i === 0 || dates[i - 1] >= d))
  await shot('04-timeline')

  await page.click('[data-tab="pipeline"]')
  await page.waitForSelector('[data-screen="pipeline"]')
  ok('pipeline shows five cards', (await page.locator('.card').count()) === 5)
  await page.locator('.card', { hasText: 'seed-sharing' }).locator('select').selectOption('agreed')
  ok('stage change moves the card', (await page.locator('[data-stage="agreed"] .card').count()) === 2)
  await shot('05-pipeline')

  await page.waitForSelector('[data-part="followups"] [data-screen="followups"]')
  ok('overdue follow-up listed', (await page.locator('[data-section="overdue"] .followup').count()) === 1)
  await page.locator('[data-section="overdue"] .followup button', { hasText: 'Done' }).first().click()
  ok('done moves it to finished', (await page.locator('[data-section="finished"] .followup').count()) === 2)
  await shot('06-followups')

  await page.reload()
  await page.waitForSelector('[data-screen="people"]')
  await page.locator('.person-row', { hasText: 'Lena Hofbauer' }).click()
  await page.waitForSelector('[data-screen="person"]')
  ok('interaction survives a reload', await page.locator('.event', { hasText: 'Donaukanal' }).count() === 1)
  await page.click('[data-tab="pipeline"]')
  await page.waitForSelector('[data-screen="pipeline"]')
  ok('stage survives a reload', (await page.locator('[data-stage="agreed"] .card').count()) === 2)

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.click('[data-tab="people"]')
  await page.waitForSelector('[data-screen="people"]')
  await shot('07-people-dark')

  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  const wp = await wide.newPage()
  await wp.goto(URL)
  await wp.waitForSelector('[data-screen="people"]')
  await wp.screenshot({ path: path.join(SHOTS, '08-desktop.png') })
  await wide.close()

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
