// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b phone-preview-extension, headless, own vite on a scratch registry and a fake `preview` CLI (never a live registry).
 * 360x780: the Preview pill, the bottom sheet (no document scroll, list scrolls inside, P06 no overlaps), like / needs work reach the CLI, note copies.
 * 1280x900: no pill, the Mac panel stays. Port 5455 (TW_PORT). Run from apps/trustweb:
 *   PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> CHROMIUM_PATH=<headless shell> TW_VITE=<vite.js> node test/e2e/preview_phone.mjs
 */
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checker, waitForServer, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5455)
const SHOTS = process.env.TW_SHOTS
const base = `http://127.0.0.1:${PORT}/`
const c = checker()
const dir = mkdtempSync(path.join(os.tmpdir(), 'preview-phone-'))
const registry = path.join(dir, 'ppxfix.json')
const logFile = path.join(dir, 'calls.log')
const bin = path.join(dir, 'preview')
writeFileSync(bin, `#!${process.execPath}
const fs = require('fs')
const [id, cmd, ...a] = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logFile)}, [cmd, ...a].join(' ') + '\\n')
const reg = JSON.parse(fs.readFileSync(${JSON.stringify(registry)}, 'utf8'))
const row = (k) => reg.features.find((f) => f.key === k)
if (cmd === 'verdict') { row(a[0]).verdict = a[1] === 'clear' ? null : a[1]; if (a[1] === 'merge') row(a[0]).checked = true; if (a[1] === 'needs-work') row(a[0]).checked = false; if (a[2] === '--note') row(a[0]).note = a[3]; else delete row(a[0]).note }
fs.writeFileSync(${JSON.stringify(registry)}, JSON.stringify(reg))
`)
chmodSync(bin, 0o755)
const feature = (key, over = {}) => ({ key, ref: 'r' + key, branch: 'wave44/' + key, title: 'Row ' + key, requires: [], where: 'Home page > ' + key, steps: ['Tap the thing', 'See the other thing'], repo: 'vanilla', checked: true, verdict: null, ...over })
const features = () => [...'abcdefghijklmnopqrst'].map((k, i) => feature(k, { checked: i % 2 === 0 }))
const write = () => writeFileSync(registry, JSON.stringify({ id: 'ppxfix', project: 'tw', short: 'ppxfix', created: new Date().toISOString(), base: 'main', baseSha: '0379fb8', worktree: dir, branch: 'preview/ppxfix', port: PORT, stockPort: PORT + 1, mode: 'personal', features: features(), assembled: { sha: 'aaa1111', at: new Date().toISOString(), error: null, restart: false } }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (pred, ms = 10_000) => { for (let t = 0; t < ms && !pred(); t += 100) await sleep(100) }
const calls = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')

write()
const vite = spawn(process.execPath, [process.env.TW_VITE || path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort', '--port', String(PORT)], {
  cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_PREVIEW: registry, TW_PREVIEW_BIN: bin }, stdio: 'ignore',
})
let browser
const overlaps = (page) => page.evaluate(() => {
  const vis = [...document.querySelectorAll('.twpp-sheet button, .twpp-pill')].filter((b) => { const r = b.getBoundingClientRect(), p = b.closest('.twpp-list')?.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!p || (r.bottom > p.top && r.top < p.bottom)) })
  const out = []
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i].getBoundingClientRect(), b = vis[j].getBoundingClientRect()
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push((vis[i].textContent + ' x ' + vis[j].textContent).slice(0, 40))
  }
  return out
})
try {
  await waitForServer(base)
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  browser = await (pw.chromium ?? pw.default.chromium).launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })

  console.log('== 360x780')
  let ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['clipboard-read', 'clipboard-write'] })
  let page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(base); await page.waitForSelector('.twpp-pill', { timeout: 20_000 })
  await sleep(900)
  c.ok('the Preview pill shows, the Mac panel is hidden', (await page.locator('.twpp-pill').isVisible()) && (await page.locator('.twp').isHidden()))
  const docFits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)
  c.ok('no document scroll with the pill', await docFits())
  await page.locator('.twpp-pill').click()
  await page.waitForSelector('.twpp-row')
  c.ok('twenty rows, loaded state per row', (await page.locator('.twpp-row').count()) === 20 && (await page.locator('.twpp-row').first().locator('.twpp-state').textContent()) === '☑' && (await page.locator('.twpp-row').nth(1).locator('.twpp-state').textContent()) === '☐')
  c.ok('where shows on a row', (await page.locator('.twpp-row .twpp-where').first().textContent()).includes('Home page > a'))
  const m = await page.evaluate(() => { const s = document.querySelector('.twpp-sheet').getBoundingClientRect(), l = document.querySelector('.twpp-list'); return { bottom: s.bottom, h: s.height, top: s.top, inner: innerHeight, scrolls: l.scrollHeight > l.clientHeight + 4 } })
  c.ok('sheet sits at the bottom edge, within 75% of the height, list scrolls inside', Math.abs(m.bottom - m.inner) < 1 && m.h <= m.inner * 0.76 && m.top >= 0 && m.scrolls, JSON.stringify(m))
  c.ok('no document scroll with the sheet open', await docFits())
  const o = await overlaps(page)
  c.ok('P06 no two buttons overlap', o.length === 0, o.join(';'))
  const w = await page.evaluate(() => { const l = document.querySelector('.twpp-list'); return l.scrollWidth <= l.clientWidth + 1 })
  c.ok('no horizontal overflow in the sheet', w)

  await page.locator('.twpp-row').nth(1).getByRole('button', { name: /Like/ }).click()
  await until(() => calls().includes('verdict b merge'))
  c.ok('like reaches the CLI as verdict merge', calls().includes('verdict b merge'), calls())
  c.ok('like shows pressed and loads the row', (await page.locator('.twpp-row').nth(1).getByRole('button', { name: /Like/ }).getAttribute('aria-pressed')) === 'true' && (await page.locator('.twpp-row').nth(1).locator('.twpp-state').textContent()) === '☑')
  // wave44 answers-44b: the optional note goes with Needs work
  await page.locator('.twpp-row').first().locator('[data-twpp-note]').fill('hides the Add button')
  await page.locator('.twpp-row').first().getByRole('button', { name: /Needs work/ }).click()
  await until(() => calls().includes('verdict a needs-work'))
  c.ok('needs work reaches the CLI with the note', calls().includes('verdict a needs-work --note hides the Add button'), calls())
  await page.locator('.twpp-row').nth(1).getByRole('button', { name: /Like/ }).click()
  await until(() => calls().includes('verdict b clear'))
  c.ok('the same press again clears', calls().includes('verdict b clear'), calls())
  await page.locator('.twpp-row').first().getByRole('button', { name: 'Note' }).click()
  await sleep(300)
  c.ok('note copies the reference to the clipboard', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('ppxfix | a | Row a | wave44/a@'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-preview-extension-sheet-360.png` })
  await page.locator('.twpp-x').click()
  c.ok('close returns the pill', await page.locator('.twpp-pill').isVisible())
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-preview-extension-pill-360.png` })
  c.ok('no page errors', errors.length === 0, errors.join(';'))
  await ctx.close()

  console.log('== 1280x900')
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await ctx.newPage()
  await page.goto(base); await page.waitForSelector('.twp header', { timeout: 20_000 })
  c.ok('wide shell: no pill, the Mac panel stays', (await page.locator('.twpp-pill').count()) === 0 && (await page.locator('.twp').isVisible()))
  await page.locator('.twp .loadhead').click(); await sleep(300)
  c.ok('the Mac panel shows the verdict note', (await page.locator('.twp .twp-note').allTextContents()).includes('📝 hides the Add button'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/answers-44b-note-1280.png` })
  await ctx.close()
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
console.log(c.failures ? `FAIL ${c.failures}` : `preview phone: OK (${c.passes})`)
process.exit(c.failures ? 1 : 0)
