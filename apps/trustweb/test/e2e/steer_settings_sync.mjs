// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-settings-sync: Sync is the LAST section of Settings; on a phone the Obsidian / Tana entries sit in its Advanced; the entries open the Import page.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_CHROMIUM_EXE=<chrome> TW_PORT=5293 TW_SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/steer_settings_sync.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []
const app = await startApp(Number(process.env.TW_PORT || 5293))
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
try {
  for (const [label, opts, phone] of [
    ['360', { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true }, true],
    ['1280', { viewport: { width: 1280, height: 900 } }, false],
  ]) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await page.goto(app.base)
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500)
    await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' })
    await page.getByLabel('Your first name').fill('Smoke Tester')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.locator('[data-settings-gear]').first().waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
    await page.locator('[data-settings-gear]').first().click()
    await page.locator('.sheet.on[data-kind=settings]').waitFor()
    await page.waitForTimeout(450)
    await page.locator('[data-settings-advanced-all] > summary').click(); await page.waitForTimeout(250)
    const adv = page.locator('[data-settings-advanced-all]')
    const last = await adv.evaluate((d) => { const k = [...d.children].filter((c) => c.matches('[data-settings-section],[data-settings-group]')); const l = k.at(-1); return l?.getAttribute('data-settings-section') })
    t.ok(`${label}: Sync is the last section of Settings`, last === 'sync', String(last))
    const sync = page.locator('[data-settings-section="sync"]')
    await sync.scrollIntoViewIfNeeded()
    t.ok(`${label}: titled Sync`, (await sync.locator('> summary').innerText()).trim() === 'Sync')
    const subAdv = sync.locator('[data-settings-sync-advanced]')
    if (phone) {
      t.ok(`${label}: Obsidian / Tana entries sit in the Sync Advanced, closed`, (await subAdv.count()) === 1 && !(await subAdv.evaluate((d) => d.open)))
      t.ok(`${label}: no entry visible before Advanced`, !(await page.locator('[data-settings-sync-tana]').isVisible()))
      await subAdv.locator('summary').click(); await page.waitForTimeout(250)
    } else {
      t.ok(`${label}: no Advanced inside Sync on a computer`, (await subAdv.count()) === 0)
    }
    t.ok(`${label}: Obsidian and Tana entries visible`, (await page.locator('[data-settings-sync-obsidian]').isVisible()) && (await page.locator('[data-settings-sync-tana]').isVisible()))
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `steer-settings-sync-${label}.png`) })
    await page.locator('[data-settings-sync-tana]').click()
    await page.locator('.eyebrow', { hasText: 'Tana' }).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    t.ok(`${label}: the Tana entry opens the Import page`, (await page.locator('[data-import-tana], [data-import-obsidian], [data-import-obsidian-off], h4.eyebrow:has-text("Tana")').count()) > 0)
    await ctx.close()
  }
} finally { await browser.close(); await app.stop() }
t.ok('no page errors', errors.length === 0, errors.join('; '))
process.exit(t.failures ? 1 : 0)
