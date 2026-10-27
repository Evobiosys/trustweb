// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Preview panel polish (wave 22), headless, own vite on a scratch registry (never a live one):
 *   A. Walk opens the yellow step card (Back / Done) and keeps it across the registry poll
 *   B. the panel's scroll offset survives a reload
 *   C. an assembly with an error never reloads the page (0 navigations in 30 s); a clean new sha reloads it exactly once
 *   D. no horizontal scroll in the panel; every "?" visible at the default width
 * Port 5420 (TW_PORT). Run from apps/trustweb:
 *   PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> CHROMIUM_PATH=<headless shell> node test/e2e/panel_polish.mjs
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checker, waitForServer, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5420)
const base = `http://127.0.0.1:${PORT}/`
const c = checker()
const dir = mkdtempSync(path.join(os.tmpdir(), 'panel-polish-'))
const registry = path.join(dir, 'ppfix.json')
const bin = path.join(dir, 'preview')
writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o755)

const feature = (key) => ({ key, ref: 'r' + key, branch: 'wave22/' + key, title: 'Feature ' + key, requires: [], selector: '.page-dock', where: 'Home page', steps: ['Dock @ .page-dock', 'Not there yet @ [data-never-here]'], repo: 'vanilla', checked: true })
const reg = (assembled) => ({ id: 'ppfix', project: 'tw', short: 'ppfix', created: new Date().toISOString(), base: 'main', baseSha: '7e79831', worktree: dir, branch: 'preview/ppfix', port: PORT, stockPort: PORT + 1, mode: 'personal', features: 'abcdefghijklmnopqrst'.split('').map(feature), assembled })
const write = (assembled) => { writeFileSync(registry, JSON.stringify(reg(assembled))) }
const asm = (sha, error = null) => ({ sha, at: new Date().toISOString(), error, restart: false })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

write(asm('aaa1111'))
const vite = spawn(process.execPath, [process.env.TW_VITE || path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort', '--port', String(PORT)], {
  cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_PREVIEW: registry, TW_PREVIEW_BIN: bin }, stdio: 'ignore',
})
let browser
try {
  await waitForServer(base)
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  browser = await (pw.chromium ?? pw.default.chromium).launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage()
  const open = async () => { await page.goto(base); await page.waitForSelector('.twp .feat', { timeout: 20_000 }) }
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('twp-more-ppfix', '1') } })
  await open()

  console.log('D. panel width')
  const d = await page.evaluate(() => { const t = document.querySelector('.twp'), r = t.getBoundingClientRect(); return { scroll: t.scrollWidth - t.clientWidth, hidden: getComputedStyle(t).overflowX, qs: [...document.querySelectorAll('.twp .feat .mini.alt')].map((e) => e.getBoundingClientRect().right <= r.right) } })
  c.ok('no horizontal scroll', d.scroll === 0, JSON.stringify(d))
  c.ok('overflow-x hidden', d.hidden === 'hidden')
  c.ok('every ? visible', d.qs.length > 0 && d.qs.every(Boolean))

  console.log('A. Walk')
  await page.locator('.twp .feat').first().locator('.mini', { hasText: 'Walk' }).click()
  const card = page.locator('.twp-step')
  c.ok('step card shows step 1 of 2', (await card.textContent({ timeout: 3000 }).catch(() => '')).includes('Step 1 of 2: Dock'))
  c.ok('card has Back and Done', (await card.locator('button', { hasText: 'Back' }).count()) === 1 && (await card.locator('button', { hasText: 'Done' }).count()) === 1)
  write(asm('aaa1111')); await sleep(5000)
  c.ok('card survives the registry poll', (await card.count()) === 1)
  await card.locator('button', { hasText: 'Next' }).click()
  c.ok('Next goes to step 2', (await card.textContent()).includes('Step 2 of 2'))
  await card.locator('button', { hasText: 'Done' }).click()
  c.ok('Done closes it', (await card.count()) === 0)

  console.log('B. scroll kept')
  await sleep(300) // a scroll right after a render counts as the browser's clamping
  await page.evaluate(() => { document.querySelector('.twp').scrollTop = 220 }); await sleep(300)
  await open(); await sleep(500)
  const top = await page.evaluate(() => document.querySelector('.twp').scrollTop)
  c.ok('scroll offset restored after reload', Math.abs(top - 220) <= 2, String(top))

  console.log('C. no reload loop (30 s)')
  let navs = 0
  const urls = []
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { navs++; urls.push(f.url()) } })
  write(asm('bbb2222', 'CONFLICT (content): Merge conflict in x.ts'))
  await sleep(30_000)
  c.ok('0 navigations while the assembly has an error', navs === 0, String(navs))
  c.ok('the error text shows in the panel', (await page.locator('.twp .warn', { hasText: 'CONFLICT' }).count()) === 1)
  write(asm('ccc3333'))
  await sleep(14_000)
  c.ok('a clean new sha goes through the wait page once and lands back', urls.filter((u) => u.includes('/__tw/wait')).length === 1 && page.url() === base, urls.join(' '))
  const after = navs
  await sleep(12_000)
  c.ok('then nothing more', navs === after, `${navs} vs ${after}`)
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
console.log(c.failures ? `FAIL ${c.failures}` : `panel polish: OK (${c.passes})`)
process.exit(c.failures ? 1 : 0)
