// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27: the settings gear on every main screen; Settings leads with the section it was opened from.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_CHROMIUM_EXE=<chrome> TW_VITE=../crm/node_modules/vite/bin/vite.js TW_PORT=5431 TW_SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/settings_everywhere.mjs
 */
import path from 'node:path'
import { launch, startApp, startPhone, tally } from '../helpers/e2e_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []
const app = await startApp(Number(process.env.TW_PORT || 5431))
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
try {
  for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await startPhone(page, app.base)
    await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
    const tabs = await page.locator('.tabs button').count()
    for (const [from, tab, expect] of [['web', 0, ['web', 'chat', 'record', 'events', 'inventory', 'general']], ['events', 3, ['events', 'web', 'chat', 'record', 'inventory', 'general']]]) {
      await page.locator('.tabs button').nth(tab).click()
      const gears = page.locator('.screen .hdr [aria-label="Settings"]')
      await gears.first().waitFor()
      t.ok(`${label} ${from}: one settings gear in the header`, (await gears.count()) === 1, String(await gears.count()))
      await gears.first().click()
      await page.locator('.sheet.on [data-settings-group]').first().waitFor()
      const ids = await page.locator('.sheet.on [data-settings-group]').evaluateAll((n) => n.map((d) => d.dataset.settingsGroup))
      const open = await page.locator('.sheet.on [data-settings-group]').evaluateAll((n) => n.filter((d) => d.open).map((d) => d.dataset.settingsGroup))
      t.ok(`${label} ${from}: group order`, JSON.stringify(ids.filter((i) => expect.includes(i))) === JSON.stringify(expect.filter((i) => ids.includes(i))) && ids[0] === from && ids.at(-1) === 'general', ids.join())
      t.ok(`${label} ${from}: only the first group is open`, open.join() === from, open.join())
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-from-${from}-${label}.png`) })
      await page.locator('.sheet.on [data-sheet-home]').click()
      await page.locator('.sheet.on').waitFor({ state: 'detached' })
    }
    t.ok(`${label}: ${tabs} tabs`, tabs >= 4)
    await ctx.close()
  }
  t.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally { await browser.close(); await app.stop() }
process.exit(t.failures ? 1 : 0)
