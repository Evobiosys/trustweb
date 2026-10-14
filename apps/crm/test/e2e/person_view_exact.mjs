/**
 * Wave 7 proof: tapping a person in the app's Web view (outliner) opens the Web Curator's own person page in the sheet.
 * Needs the personal preview (Jakob's record, Andrew Hasse in it):  PORT=5192 node test/e2e/person_view_exact.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const url = `http://127.0.0.1:${process.env.PORT ?? 5192}/`
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'pv-exact-')), { headless: true, viewport: { width: 390, height: 844 }, args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = false
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
await page.goto(url)
await page.getByRole('button', { name: 'Manage and search contacts' }).click()
await page.locator('.operson', { hasText: 'Andrew Hasse' }).locator('.who').click()
const page_ = page.locator('.curator-person')
await page_.getByText('Merge with').first().waitFor({ timeout: 15_000 })
ok('Curator page: Merge with', true)
for (const t of ['Contact info', 'Notes', 'What happened']) ok(`Curator page: ${t}`, (await page_.getByText(t, { exact: false }).count()) > 0)
ok('Curator page: Andrew Hasse', (await page_.getByRole('heading', { name: /Andrew Hasse/ }).count()) > 0)
ok('no re-created form (no First name field)', (await page.getByLabel('First name').count()) === 0)
await page.screenshot({ path: process.env.SHOT ?? path.join(tmpdir(), 'pv-exact.png') })
ok('no page errors', errors.length === 0)
await ctx.close()
process.exit(failed ? 1 : 0)
