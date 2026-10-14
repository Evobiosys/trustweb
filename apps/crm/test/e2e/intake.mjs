/**
 * Headless run of the contacts import: starts Vite on 5291, opens the CRM at
 * 390x812, imports test/fixtures/contacts/demo_folder as a folder, checks the
 * summary, answers one review card, saves, opens a contact, reloads, undoes.
 * Kills the server it started. Run from apps/crm: node test/e2e/intake.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.CRM_PORT || 5291)
const SHOTS = process.env.CRM_SHOTS || path.join(HERE, 'shots')
const URL = `http://127.0.0.1:${PORT}/`
const DEMO = path.join(ROOT, 'test/fixtures/contacts/demo_folder')

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
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `intake-${name}.png`) })
  const total = async (k) => (await page.locator(`[data-total="${k}"]`).innerText()).trim()

  await page.goto(URL)
  await page.waitForSelector('[data-screen="people"]')
  ok('no contacts section before an import', (await page.locator('[data-part="contacts-heading"]').count()) === 0)

  await page.click('[data-action="import-contacts"]')
  await page.waitForSelector('[data-screen="import"]')
  await page.setInputFiles('[data-input="folder"]', DEMO)
  await page.waitForSelector('[data-part="totals"]')
  const files = await page.locator('[data-part="files"] li').allInnerTexts()
  ok('three contact files listed, photo not read', files.length === 3 && files.some((f) => f.includes('Google CSV')) && files.some((f) => f.includes('Facebook')) && files.some((f) => f.includes('vCard')), files.join(' | '))
  ok('one other file counted as not read', (await page.locator('text=1 other file, not read').count()) === 1)
  ok('summary: 18 new, 0 already here', (await total('new')) === '18 new' && (await total('already')) === '0 already here')
  ok('summary: 4 merged automatically, 2 to review', (await total('sure')) === '4 merged automatically' && (await total('review')) === '2 to review')
  ok('two review cards', (await page.locator('[data-group="review"]').count()) === 2)
  ok('sure groups collapsed in one line', (await page.locator('[data-part="sure"] summary').innerText()).includes('4 merged automatically'))
  await shot('1-summary')

  await page.locator('[data-group="review"]').first().locator('[data-action="same"]').click()
  ok('"Same person" is pressed', (await page.locator('[data-group="review"]').first().locator('[data-action="same"]').getAttribute('aria-pressed')) === 'true')
  await page.click('[data-part="sure"] summary')
  await shot('2-review')
  await page.click('[data-action="save-import"]')

  await page.waitForSelector('[data-screen="people"]')
  // 18 contacts - 5 folded by the sure groups (3 pairs + a trio) - 1 answered "same" = 12
  const heading = '[data-part="contacts-heading"]'
  ok('Contacts section shows 12', (await page.locator(heading).innerText()).includes('(12)'), await page.locator(heading).innerText())
  ok('sample people still listed', (await page.locator('.person-row:not([data-contact])').count()) === 7)
  await page.fill('input[type="search"]', 'fischer')
  ok('search finds the merged Fischer', (await page.locator('[data-contact]').count()) === 1)
  await page.fill('input[type="search"]', '')
  await shot('3-people')

  await page.locator('[data-contact]', { hasText: 'Anna Gruber' }).click()
  await page.waitForSelector('[data-screen="contact"]')
  ok('contact page header', (await page.locator('h2').innerText()).includes('Anna Gruber'))
  ok('contact info collapsed', (await page.locator('.contact-row').count()) === 0)
  const from = await page.locator('[data-part="from"]').innerText()
  ok('from Phone / vCard and Google', from.includes('Phone / vCard') && from.includes('Google'), from)
  await page.click('[data-action="contact-info-toggle"]')
  ok('mailto link after expanding', (await page.locator('a[href="mailto:anna.gruber@example.at"]').count()) === 1)
  await shot('4-contact')

  await page.reload()
  await page.waitForSelector('[data-screen="people"]')
  ok('contacts survive a reload', (await page.locator(heading).innerText()).includes('(12)'))

  ok('undo offered', (await page.locator('[data-action="undo-import"]').count()) === 1)
  await page.click('[data-action="undo-import"]')
  ok('undo empties Contacts', (await page.locator(heading).count()) === 0 && (await page.locator('[data-action="undo-import"]').count()) === 0)
  await page.reload()
  await page.waitForSelector('[data-screen="people"]')
  ok('undo survives a reload', (await page.locator('[data-contact]').count()) === 0)

  ok('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  failures++
  console.log(`  FAIL  run aborted  ->  ${e?.stack || e}`)
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
