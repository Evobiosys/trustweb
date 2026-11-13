// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 settings-llm-first: Settings is a full screen with a short page; Advanced holds the rest; search jumps into Advanced; no native checkbox.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_CHROMIUM_EXE=<chrome> TW_PORT=5419 TW_SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/settings_llm_first.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []
const app = await startApp(Number(process.env.TW_PORT || 5419))
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
const apart = (a, b) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
try {
  for (const [label, viewport] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await page.goto(app.base)
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500)   // review wave 42: a fresh dev server reloads once; a name typed before is lost
    // The dev server's preview banner (.twf) lies over the page in dev; hide it like the other e2e files do.
    await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' })
    await page.getByLabel('Your first name').fill('Smoke Tester')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.locator('[data-settings-gear]').first().waitFor({ timeout: 15_000 }).catch(async (e) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'dbg-start.png') }); throw e })
    await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
    await page.locator('[data-settings-gear]').first().click()
    const sheet = page.locator('.sheet.on[data-kind=settings]')
    await sheet.waitFor()
    await page.waitForTimeout(450)   // the slide-in
    const phone = await page.locator('.phone, #app').first().boundingBox().catch(() => null)
    const box = await sheet.boundingBox()
    t.ok(`${label}: Settings covers its whole container (top 0, full height)`, box.y <= 1 && box.height >= (phone?.height ?? viewport.height) - 2, JSON.stringify(box))
    const hit = await sheet.evaluate((s) => { const r = s.getBoundingClientRect(); return [[r.left + 8, r.top + r.height - 8], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + 8]].every(([x, y]) => s.contains(document.elementFromPoint(x, y))) })
    t.ok(`${label}: no underlying page shows through`, hit)
    // short page
    const simple = await sheet.locator('[data-settings-group=simple] > *').count()
    t.ok(`${label}: the short page lists 1..12 entries`, simple >= 1 && simple <= 12, String(simple))
    t.ok(`${label}: Advanced starts closed`, !(await sheet.locator('[data-settings-advanced-all]').evaluate((d) => d.open)))
    t.ok(`${label}: no flags row visible before Advanced`, !(await sheet.locator('[data-flag-toggle]').first().isVisible().catch(() => false)))
    // a registry switch works
    const sw = sheet.locator('[data-setting-switch="chats.hidden"]')
    const before = await sw.getAttribute('aria-checked')
    await sw.click()
    t.ok(`${label}: the Do not disturb switch flips`, (await page.locator('.sheet.on [data-setting-switch="chats.hidden"]').getAttribute('aria-checked')) !== before)
    // P06: header controls vs search vs list do not overlap
    const bar = await sheet.locator('.sheet-bar').boundingBox()
    const search = await sheet.locator('[data-settings-search]').boundingBox()
    const first = await sheet.locator('[data-settings-group=simple]').boundingBox()
    t.ok(`${label}: back bar, search field and list do not overlap`, apart(bar, search) && apart(search, first), JSON.stringify([bar, search, first]))
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-llm-first-short-${label}.png`) })
    // search "flag" jumps into Advanced
    await sheet.locator('[data-settings-search]').fill('flag')
    await page.locator('.sheet.on [data-flag-toggle]').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    t.ok(`${label}: searching "flag" opens Advanced and shows the flag`, await sheet.locator('[data-flag-toggle]').first().isVisible())
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-llm-first-flag-${label}.png`) })
    // B07: no native checkbox without role=switch, anywhere in Settings once Advanced is open
    await sheet.locator('[data-settings-search]').fill('')
    await sheet.locator('[data-settings-advanced-all] > summary').click().catch(() => {})
    await sheet.evaluate((s) => { s.querySelectorAll('details').forEach((d) => { d.open = true }) })
    const plain = await sheet.evaluate((s) => [...s.querySelectorAll('input[type=checkbox]')].filter((i) => i.getAttribute('role') !== 'switch').length)
    const total = await sheet.evaluate((s) => s.querySelectorAll('input[type=checkbox]').length)
    t.ok(`${label}: every checkbox in Settings is a switch (${total} found)`, plain === 0 && total > 0, String(plain))
    const appearance = await sheet.evaluate((s) => { const i = s.querySelector('input[type=checkbox]'); return i ? getComputedStyle(i).appearance : '' })
    t.ok(`${label}: the switch is drawn by the app, not the browser`, appearance === 'none', appearance)
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-llm-first-advanced-${label}.png`) })
    // back returns
    await sheet.locator('[data-sheet-home]').click()
    await page.locator('.sheet.on').waitFor({ state: 'detached' })
    t.ok(`${label}: back returns to the screen`, await page.locator('[data-settings-gear]').first().isVisible())
    await ctx.close()
  }
  t.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally { await browser.close(); await app.stop() }
process.exit(t.failures ? 1 : 0)
