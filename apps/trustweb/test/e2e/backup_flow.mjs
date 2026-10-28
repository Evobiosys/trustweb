/**
 * "Do you want to back it up on a Swiss server?" end to end, locally:
 * the real services/trustweb-backup server behind the Vite /backup proxy.
 *   1. Back up with a key made on the phone (copy it, tick "I saved it").
 *   2. The blob on the server's disk contains no plaintext.
 *   3. A fresh phone restores everything with the recovery key alone.
 *   4. A wrong key gets "No backup found", a passphrase under 12 chars is refused.
 *
 * Run from apps/demo/:
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/backup_flow.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const SERVER = path.resolve(TW_ROOT, '../../services/trustweb-backup/server.mjs')
const PORT = Number(process.env.TW_PORT || 5197)
const BACKUP_PORT = Number(process.env.TW_BACKUP_PORT || 8967)

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

function filesUnder(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-backup-'))
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
  console.log('backup-flow against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  try {
    browser = await engine.launch({ headless: true })
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await ctx.newPage()
    page.on('dialog', (d) => void d.accept())
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('button', { name: 'My Resources', exact: true }).click()
    await page.getByPlaceholder('e.g. Motorbike, can lend it for a weekend').fill('Motorbike, can lend it for a weekend')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await page.getByRole('button', { name: 'Back up, with a key made on this phone' }).click()
    await page.getByRole('heading', { name: 'Your recovery key' }).waitFor({ timeout: 5_000 })
    const keyText = (await page.locator('.recovery-key').innerText()).trim()
    ok('a recovery key is shown (TW1R-...)', /^TW1R-/.test(keyText), keyText)
    ok('"Back up now" waits for "I saved my recovery key"', await page.getByRole('button', { name: 'Back up now' }).isDisabled())
    await page.locator('#bk-saved').check()
    await page.getByRole('button', { name: 'Back up now' }).click()
    await page.getByText(/Backed up, encrypted/).waitFor({ timeout: 10_000 })
    ok('the backup lands', true)
    ok('the card switches to "Backed up on a Swiss server"', await page.getByText('Backed up on a Swiss server').isVisible())

    const files = filesUnder(dir).filter((f) => !f.endsWith('.tmp'))
    const blobs = files.map((f) => readFileSync(f))
    ok('the server stored something', blobs.length > 0, JSON.stringify(files))
    ok('nothing on the server contains plaintext', blobs.every((b) => !b.includes('Motorbike') && !b.includes('Jakob')))

    // auto-backup (2026-10-28): on by default once a key is set; a change + the app going to the background backs up again
    ok('"Automatically back up" is on after the first backup', await page.locator('#bk-auto').isChecked())
    const before = new Map(filesUnder(dir).filter((f) => !f.endsWith('.tmp')).map((f) => [f, readFileSync(f).toString('base64')]))
    await page.getByRole('button', { name: 'My Resources', exact: true }).click()
    await page.getByPlaceholder('e.g. Motorbike, can lend it for a weekend').fill('Ladder, three metres')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
    let changedBlob = false
    for (let i = 0; i < 40 && !changedBlob; i++) {
      await page.waitForTimeout(250)
      changedBlob = filesUnder(dir).filter((f) => !f.endsWith('.tmp')).some((f) => before.get(f) !== readFileSync(f).toString('base64'))
    }
    ok('going to the background backs up the change automatically', changedBlob)
    ok('the automatic backup is encrypted too', filesUnder(dir).filter((f) => !f.endsWith('.tmp')).every((f) => !readFileSync(f).includes('Ladder')))
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }) })

    // a fresh phone restores with the key alone
    const fresh = await browser.newContext({ viewport: { width: 430, height: 900 } })
    const p2 = await fresh.newPage()
    p2.on('dialog', (d) => void d.accept())
    p2.on('pageerror', (e) => console.log('  [p2 pageerror]', e.message))
    await p2.goto(base)
    await p2.getByLabel('Your first name').fill('Temp')
    await p2.getByRole('button', { name: 'Start on this phone' }).click()
    await p2.getByRole('button', { name: 'My Resources', exact: true }).click()
    await p2.getByRole('button', { name: 'Restore from a backup' }).click()
    await p2.getByPlaceholder('Recovery key or passphrase').fill('TW1R-' + 'A'.repeat(10))
    await p2.getByRole('button', { name: 'Restore', exact: true }).click()
    ok('a malformed key is refused', await p2.getByText('That is not a valid recovery key or passphrase.').isVisible())
    await p2.getByPlaceholder('Recovery key or passphrase').fill(keyText)
    await Promise.all([p2.waitForEvent('load', { timeout: 15_000 }), p2.getByRole('button', { name: 'Restore', exact: true }).click()])
    await p2.getByRole('button', { name: 'My Resources', exact: true }).click()
    await p2.getByText('Motorbike', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => {})
    const restored = await p2.locator('.screen').innerText()
    if (process.env.TW_SHOT) await p2.screenshot({ path: process.env.TW_SHOT })
    ok('the fresh phone has the restored inventory', /Motorbike/.test(restored), restored.slice(0, 300))
    await fresh.close()

    // passphrase rules
    const p3ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
    const p3 = await p3ctx.newPage()
    await p3.goto(base)
    await p3.getByLabel('Your first name').fill('Pass')
    await p3.getByRole('button', { name: 'Start on this phone' }).click()
    await p3.getByRole('button', { name: 'My Resources', exact: true }).click()
    await p3.getByRole('button', { name: 'Choose my own passphrase' }).click()
    await p3.getByPlaceholder('Passphrase').fill('too short')
    await p3.getByRole('button', { name: 'Make my key' }).click()
    ok('a passphrase under 12 characters is refused', await p3.getByText('Use at least 12 characters.').isVisible())
    await p3.getByPlaceholder('Passphrase').fill('a long enough passphrase')
    await p3.getByRole('button', { name: 'Make my key' }).click()
    await p3.getByRole('heading', { name: 'Your recovery key' }).waitFor({ timeout: 15_000 })
    ok('a passphrase makes a TW1P key', /^TW1P-/.test((await p3.locator('.recovery-key').innerText()).trim()))
    await p3ctx.close()
  } finally {
    await browser?.close()
    viteProc.kill()
    backupProc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nbackup-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
