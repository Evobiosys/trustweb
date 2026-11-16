// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 sync-visibility: on a phone the Import page lists no Obsidian / Tana section until Advanced is opened; on a computer both stand in the page.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_CHROMIUM_EXE=<chrome> TW_PORT=5436 TW_SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/sync_visibility.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []
const app = await startApp(Number(process.env.TW_PORT || 5436))
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
    await page.locator('[data-setting="ui.import"]').first().click()
    await page.locator('[data-import-tana-show], .eyebrow', { hasText: 'Tana' }).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
    const adv = page.locator('[data-sync-advanced]')
    if (phone) {
      t.ok(`${label}: the Advanced disclosure exists and starts closed`, (await adv.count()) === 1 && !(await adv.evaluate((d) => d.open)))
      t.ok(`${label}: no Obsidian / Tana heading visible before Advanced`, !(await page.locator('h4.eyebrow', { hasText: /Obsidian|Tana/ }).first().isVisible().catch(() => false)))
      t.ok(`${label}: the hint line is there`, (await page.locator('[data-sync-phone-hint]').count()) === 1)
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-visibility-${label}-closed.png`) })
      await adv.locator('summary').click(); await page.waitForTimeout(250)
      t.ok(`${label}: opened, Obsidian and Tana headings are visible`, (await page.locator('h4.eyebrow', { hasText: 'Obsidian' }).first().isVisible()) && (await page.locator('h4.eyebrow', { hasText: 'Tana' }).first().isVisible()))
      await adv.locator('summary').scrollIntoViewIfNeeded()
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-visibility-${label}-open.png`) })
    } else {
      t.ok(`${label}: no Advanced disclosure on the Import page`, (await adv.count()) === 0)
      t.ok(`${label}: Obsidian and Tana headings stand in the page`, (await page.locator('h4.eyebrow', { hasText: 'Obsidian' }).first().isVisible()) && (await page.locator('h4.eyebrow', { hasText: 'Tana' }).first().isVisible()))
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sync-visibility-${label}.png`) })
    }
    await ctx.close()
  }
} finally { await browser.close(); await app.stop() }
t.ok('no page errors', errors.length === 0, errors.join('; '))
process.exit(t.failures ? 1 : 0)
