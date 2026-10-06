/**
 * Import inventory file (wave 1733 round B, amendment A4), in the real app:
 * a summary before anything is written; the lines land as "Only me" and say
 * "from Tana"; nothing is sent anywhere while importing; re-importing adds
 * nothing; "Undo import" takes away what the import added except a line the
 * person changed; a wrong file is refused plainly.
 * Ports: Vite 5298. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/import_flow.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const openSettings = async (page) => {
  await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('[data-import-open]').waitFor({ timeout: 5_000 })
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-import-'))
  const good = path.join(dir, 'trustweb-inventory-import.json')
  writeFileSync(good, JSON.stringify({
    format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-10-06',
    items: [
      { key: '0123456789abcdef', text: 'Knows the Graz housing co-op board', audience: 'me', provenance: 'tana', allowedInAdvance: true },
      { key: 'fedcba9876543210', text: 'Can lend a cargo bike on weekends', audience: 'me', provenance: 'tana', allowedInAdvance: false },
      { key: 'aaaaaaaaaaaaaaaa', text: 'Speaks Swahili', audience: 'me', provenance: 'mac', allowedInAdvance: false },
      { key: 'broken', text: 'left out' },
    ],
  }))
  const wrong = path.join(dir, 'other.json')
  writeFileSync(wrong, JSON.stringify({ format: 'something-else', version: 1, items: [] }))
  const relay = await startRelay()
  const vite = await startVite(5298, { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    const page = await newPhone(browser, errors)
    await startPhone(page, vite.base, 'Jakob')
    await openSettings(page)
    await shot(page, '14-import-in-settings')
    const sent = []
    page.on('request', (r) => { if (/\/(backup|hosted|transcribe|feedback)\b/.test(r.url()) || !['GET'].includes(r.method())) sent.push(r.method() + ' ' + r.url()) })
    await page.locator('[data-import-file]').setInputFiles(good)
    await page.locator('[data-import-summary]').waitFor({ timeout: 5_000 })
    const summary = await page.locator('.sheet.on').innerText()
    ok('a summary first: 3 new lines, 1 entry left out, 1 allowed in advance', /3 new lines/.test(summary) && /1 entry in the file could not be read/.test(summary) && /1 of them is marked "allowed in advance"/.test(summary), summary)
    ok('nothing is written before the yes', (await record(page)).inventory.length === 0)
    await shot(page, '15-import-summary')
    await page.locator('[data-import-apply]').click()
    await page.locator('.toast.on', { hasText: '3 added' }).waitFor({ timeout: 5_000 })
    const r1 = await record(page)
    ok('the lines land as "Only me", from Tana, with the file\'s key', r1.inventory.length === 3 && r1.inventory.every((i) => i.audience === 'me' && i.source?.kind === 'tana' && /^[0-9a-f]{16}$/.test(i.source.ref)))
    ok('nothing was sent anywhere while importing', sent.length === 0, sent.join(' | '))
    await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await page.locator('.inv-text', { hasText: 'Graz housing' }).click()
    ok('the item says where it came from: Tana', await page.locator('.sheet.on [data-provenance="tana"]').count() === 1)
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await shot(page, '16-imported-lines-inventory')

    await openSettings(page)
    await page.locator('[data-import-file]').setInputFiles(good)
    await page.locator('[data-import-summary]').waitFor({ timeout: 5_000 })
    ok('importing the same file again adds nothing (idempotent)', (await page.locator('[data-import-summary]').getAttribute('data-import-summary')) === '0/3' && await page.locator('[data-import-apply]').count() === 0)
    await page.locator('.sheet.on .btn-ghost').last().click()

    // the person shares one of them with friends: Undo leaves that one
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
    await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await page.locator('.inv', { hasText: 'cargo bike' }).locator('.aud').click()
    await openSettings(page)
    await page.locator('[data-import-undo]').click()
    await page.locator('.toast.on', { hasText: 'taken away' }).waitFor({ timeout: 5_000 })
    const r2 = await record(page)
    ok('Undo import takes away what it added, except the line the person changed', r2.inventory.length === 1 && /cargo bike/.test(r2.inventory[0].text) && !r2.imports, JSON.stringify(r2.inventory.map((i) => i.text)))

    await page.locator('[data-import-file]').setInputFiles(wrong)
    await page.locator('[data-import-problem]').waitFor({ timeout: 5_000 })
    ok('a wrong file is refused plainly, nothing written', /not a TrustWeb inventory file/.test(await page.locator('[data-import-problem]').innerText()) && (await record(page)).inventory.length === 1)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nimport-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
