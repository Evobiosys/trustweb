/**
 * Wave 7: the Manage outliner. Collapsed row (name, context, favourite link), expanded simple and advanced views, a value written to the
 * person's `fields`, and a long-press drag that moves a field across the sections and stays after a reload.
 *
 * Run from apps/demo/:  PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/outliner_flow.mjs
 * (OUTLINER_CHANNEL=chrome uses the installed Chrome instead of a downloaded Chromium.) Local only: a Vite dev server on TW_PORT.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const PORT = Number(process.env.TW_PORT || 5199)
let failures = 0
const ok = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++ }

async function main() {
  const vite = spawn(process.execPath, [path.resolve(TW_ROOT, '../demo/node_modules/vite/bin/vite.js'), '--strictPort'], { cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT) }, stdio: 'ignore' })
  const base = `http://127.0.0.1:${PORT}/`
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)) }
  let browser = null
  try {
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    const engine = (pw.chromium ? pw : pw.default).chromium
    browser = await engine.launch({ headless: true, channel: process.env.OUTLINER_CHANNEL })
    const page = await (await browser.newContext({ viewport: { width: 430, height: 3200 }, hasTouch: true })).newPage()
    page.on('pageerror', (e) => { failures++; console.log('  [pageerror]', e.message) })
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.locator('.rings-wrap').click({ position: { x: 176 + 114, y: 176 } })
    await page.getByPlaceholder('Name').first().fill('Lena Berger')
    await page.getByRole('button', { name: 'Add to my web' }).click()
    await page.locator('.node', { hasText: 'Lena' }).waitFor()

    await page.getByRole('button', { name: 'Manage and search contacts' }).click()
    const row = page.locator('.operson', { hasText: 'Lena Berger' })
    await row.locator('.who').click()
    ok('simple view: first name, last name, context, ring, favourite', (await row.locator('.osection[data-section=simple] .ofield').count()) === 5)
    ok('first and last name split', (await row.locator('[data-field=tw-first] input').inputValue()) === 'Lena' && (await row.locator('[data-field=tw-last] input').inputValue()) === 'Berger')

    await row.getByRole('button', { name: 'More fields' }).click()
    await row.locator('[data-field=tw-phone] input').fill('+43 660 1234567')
    await row.locator('[data-field=tw-favourite] select').selectOption('call')
    await row.locator('.who').click()
    ok('collapsed row shows the favourite way as a tel: link', (await row.locator('a.ofav').getAttribute('href')) === 'tel:+436601234567')

    await row.locator('.who').click()
    ok('a field with a value shows in simple', (await row.locator('.osection[data-section=simple] [data-field=tw-phone]').count()) === 1)
    const nick = row.locator('[data-field=ZpMV4Fqu_0JZ]')
    await row.getByRole('button', { name: 'More fields' }).click()
    const from = await nick.locator('.olabel').boundingBox()
    const to = await row.locator('.osection[data-section=simple] [data-field=tw-first]').boundingBox()
    await page.mouse.move(from.x + 10, from.y + from.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.move(to.x + 10, to.y + 4, { steps: 5 })
    await page.mouse.up()
    ok('long-press drag moves a field into simple, before First name', (await row.locator('.osection[data-section=simple] .ofield').first().getAttribute('data-field')) === 'ZpMV4Fqu_0JZ')
    await page.reload()
    await page.getByRole('button', { name: 'Manage and search contacts' }).click()
    await page.locator('.operson', { hasText: 'Lena Berger' }).locator('.who').click()
    ok('placement stays after a reload', (await page.locator('.operson.open .osection[data-section=simple] .ofield').first().getAttribute('data-field')) === 'ZpMV4Fqu_0JZ')
  } finally {
    await browser?.close()
    vite.kill()
  }
  console.log(failures ? `${failures} FAILED` : 'outliner flow: all passed')
  process.exit(failures ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
