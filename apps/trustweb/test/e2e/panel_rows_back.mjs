// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 panel-rows-back (Jakob 2026-11-23 00:03: "bring back the line by line approver on the top left, I can't approve them"):
 * the panel's × ("Hide for this tab") used to leave no way back for the tab's lifetime (sessionStorage twp-hidden). Now it leaves a
 * "≡ rows" pill top-left; a tap brings the line-by-line approver back, and the tab remembers that across reloads. The Approve wave box stays.
 * Headless, own vite on a scratch registry and a fake `preview` CLI (never a live registry), same setup as review_panel.mjs.
 * Port 5416 (TW_PORT). Run from apps/trustweb:
 *   PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> CHROMIUM_PATH=<headless shell> TW_VITE=<vite.js> node test/e2e/panel_rows_back.mjs
 * Screens: TW_SHOTS=<dir> (DEVLOG/wave46/screens/panel-rows-back-*.png).
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checker, waitForServer, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5416)
const SHOTS = process.env.TW_SHOTS
const base = `http://127.0.0.1:${PORT}/`
const c = checker()
const dir = mkdtempSync(path.join(os.tmpdir(), 'panel-rows-back-'))
const registry = path.join(dir, 'rbfix.json')
const bin = path.join(dir, 'preview')
writeFileSync(bin, `#!${process.execPath}
const fs = require('fs')
const [id, cmd, ...a] = process.argv.slice(2)
const reg = JSON.parse(fs.readFileSync(${JSON.stringify(registry)}, 'utf8'))
const row = (k) => reg.features.find((f) => f.key === k)
if (cmd === 'verdict') row(a[0]).verdict = a[1] === 'clear' ? null : a[1]
if (cmd === 'toggle') row(a[0]).checked = a[1] === 'on'
fs.writeFileSync(${JSON.stringify(registry)}, JSON.stringify(reg))
`)
chmodSync(bin, 0o755)
const devlog = path.join(dir, 'DEVLOG')
mkdirSync(path.join(devlog, 'wave1'), { recursive: true })

const feature = (key, over = {}) => ({ key, ref: 'r' + key, branch: 'wave46/' + key, title: key, requires: [], selector: '.page-dock', where: 'Home page', steps: [], repo: 'vanilla', checked: true, verdict: null, ...over })
const reg = () => ({ id: 'rbfix', project: 'tw', short: 'rbfix', created: new Date().toISOString(), base: 'main', baseSha: '0379fb8', worktree: dir, branch: 'preview/rbfix', port: PORT, stockPort: PORT + 1, mode: 'personal', features: [feature('panel-rows-back'), feature('answers-45b')], assembled: { sha: 'aaa1111', at: new Date().toISOString(), error: null, restart: false } })
writeFileSync(registry, JSON.stringify(reg()))

const vite = spawn(process.execPath, [process.env.TW_VITE || path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort', '--port', String(PORT)], {
  cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_PREVIEW: registry, TW_PREVIEW_BIN: bin, TW_DEVLOG: devlog }, stdio: 'ignore',
})
let browser
try {
  await waitForServer(base)
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  browser = await (pw.chromium ?? pw.default.chromium).launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })
  // Desktop widths only: under 700 px the phone preview extension replaces the Mac panel by its own pill + sheet (html.twpp-on hides .twp).
  let pass = 0
  for (const [w, h] of process.env.TW_VIEWPORTS ? JSON.parse(process.env.TW_VIEWPORTS) : [[1280, 900], [900, 700]]) {
    console.log(`== ${w}x${h}`)
    writeFileSync(registry, JSON.stringify(reg()))   // a fresh registry per viewport: the approve below toggles, so a verdict left over would clear instead
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const pg = await ctx.newPage()
    const errors = []
    pg.on('pageerror', (e) => errors.push(String(e)))
    const shot = async (name) => { if (SHOTS) await pg.screenshot({ path: `${SHOTS}/panel-rows-back-${name}-${w}.png` }) }
    // The load box (every row with its approve pills) starts collapsed: open it, as review_panel.mjs does.
    const openLoad = async () => { await pg.waitForSelector('.twp header', { timeout: 20_000 }); if (!(await pg.locator('.twp .feat').count())) { await pg.locator('.twp .loadhead').click({ force: true }); await pg.waitForSelector('.twp .feat', { timeout: 8000 }) } }
    await pg.goto(base)
    try { await openLoad() } catch (e) {
      // diagnostics for a changed panel layout: what the panel holds, and a shot
      console.error('panel text:', JSON.stringify(await pg.evaluate(() => ({ hidden: document.querySelector('.twp')?.hidden, cls: document.querySelector('.twp')?.className, text: document.querySelector('.twp')?.innerText?.slice(0, 600), html: document.querySelector('.twp')?.innerHTML?.slice(0, 1500) }))))
      await shot('fail')
      throw e
    }
    c.ok('the panel starts with its rows and the approve pills', (await pg.locator('.twp .pill.merge').count()) >= 2)
    await pg.locator('[data-panel-hide]').click()
    await pg.waitForSelector('[data-panel-show]', { timeout: 8000 })
    const b = await pg.locator('.twp').boundingBox()
    c.ok('× leaves a visible "rows" pill top-left and no rows', (await pg.locator('.twp .feat').count()) === 0 && !!b && b.x < 40 && b.y < 40 && b.width > 20 && (await pg.locator('[data-panel-show]').textContent()).includes('rows'), JSON.stringify(b))
    c.ok('the Approve wave box stays while the rows are hidden', !(await pg.evaluate(() => document.documentElement.classList.contains('twp-compact'))) && await pg.locator('.twf-ok').isVisible())
    await shot('pill')
    await pg.reload(); await pg.waitForSelector('[data-panel-show]', { timeout: 20_000 })
    c.ok('the pill survives a reload (the tab remembers hide, as before)', (await pg.locator('.twp .feat').count()) === 0)
    await pg.locator('[data-panel-show]').click()
    await openLoad()
    c.ok('a tap on the pill brings the line-by-line approver back', (await pg.locator('.twp .pill.merge').count()) >= 2 && (await pg.locator('[data-panel-show]').count()) === 0)
    await shot('back')
    // A different row per pass: the dev server shares an identical CLI request with the job it already ran (jobQueue), so the same verdict twice would not reach the registry a second time.
    await pg.locator('.twp .pill.merge').nth(pass++ % 2).click()
    try { await pg.waitForFunction(() => document.querySelector('.twp .pill.merge.on') !== null, null, { timeout: 8000 }) } catch (e) {
      console.error('approve diag:', readFileSync(registry, 'utf8').slice(0, 400), JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('.twp .pill')].map((b) => b.className + ':' + b.textContent + ':' + b.disabled + ':' + JSON.stringify(b.getBoundingClientRect())))), JSON.stringify(await pg.evaluate(() => ({ h: innerHeight, twp: document.querySelector('.twp').getBoundingClientRect() }))))
      await shot('approve-fail')
      throw e
    }
    c.ok('a row can be approved again after the panel came back', (await pg.locator('.twp .pill.merge.on').count()) >= 1)
    await pg.reload(); await openLoad()
    c.ok('the rows stay back after a reload (the tab remembers show)', (await pg.locator('[data-panel-show]').count()) === 0)
    c.ok('no page errors', errors.length === 0, errors.join('; '))
    await ctx.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
console.log(c.failures ? `FAIL ${c.failures}` : `panel rows back: OK (${c.passes})`)
process.exit(c.failures ? 1 : 0)
