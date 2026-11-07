// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 dev-record-carry proof (headless): two personal-preview dev servers share one live file.
 * PORT_A=5480 PORT_B=5482 TW_DEV_LIVE=<tmp file> EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node dev_record_live.mjs
 * Start both servers first, each with TW_DEV_RECORD=<seed> TW_DEV_LIVE=<same tmp file>; a third with TW_STOCK=1 on PORT_S (optional).
 */
import { readFileSync, existsSync } from 'node:fs'
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const [A, B, S] = [process.env.PORT_A ?? 5480, process.env.PORT_B ?? 5482, process.env.PORT_S]
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const open = async (port, viewport = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForTimeout(2500)
  return { ctx, page }
}
const openAdvanced = async (page) => {
  await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
  await page.locator('details[data-settings-group]:has(details[data-settings-advanced]) > summary').click(); await page.waitForTimeout(300)
  await page.locator('details[data-settings-advanced] > summary').click(); await page.waitForTimeout(300)
}
const names = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('trustweb.v1.me') ?? '{}').people ?? []).map((p) => p.name))
try {
  const a = await open(A)
  check('A seeded from the dev record', (await names(a.page)).includes('Seed Sam'))
  await a.page.evaluate(() => {
    const k = 'trustweb.v1.me'; const r = JSON.parse(localStorage.getItem(k)); r.people.find((p) => p.name === 'Seed Sam').name = 'Edited Eve'; localStorage.setItem(k, JSON.stringify(r))
  })
  await a.page.reload(); await a.page.waitForTimeout(2500)
  // a real save(): toggling a setting in Settings > Advanced saves the record, and the app posts it 2 s later
  await openAdvanced(a.page)
  await a.page.locator('[data-qr-profile-option] input').click(); await a.page.waitForTimeout(3500)
  const live = existsSync(process.env.TW_DEV_LIVE) ? readFileSync(process.env.TW_DEV_LIVE, 'utf8') : ''
  check('save() posted the record to the live file (edit included)', live.includes('Edited Eve'))
  const bad = await a.page.evaluate(async () => (await fetch('/__tw/dev-record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status)
  check('a malformed record is refused', bad === 400)
  const b = await open(B)
  check('B (second port) shows the name edited in A', (await names(b.page)).includes('Edited Eve') && !(await names(b.page)).includes('Seed Sam'))
  const before = await b.page.evaluate(() => localStorage.getItem('trustweb.v1.me.before-live'))
  check('B kept its own copy as .before-live', before !== null)
  await openAdvanced(b.page)
  const line = b.page.locator('[data-dev-record-live]')
  check('Settings > Advanced shows the synced line', (await line.count()) === 1 && /Personal preview record synced \d\d:\d\d/.test(await line.innerText()))
  await line.scrollIntoViewIfNeeded().catch(() => {})
  await b.page.screenshot({ path: `${SHOTS}/dev-record-carry-1280.png` })
  const m = await open(B, { width: 360, height: 780 })
  await m.page.screenshot({ path: `${SHOTS}/dev-record-carry-360.png` })
  if (S) {
    const s = await open(S)
    check('stock twin never reads the live file', !(await names(s.page)).includes('Edited Eve'))
    const code = await s.page.evaluate(async () => (await fetch('/__tw/dev-record')).headers.get('content-type'))
    check('stock twin has no live route (HTML fallback, not JSON)', !/json/.test(code ?? ''))
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
