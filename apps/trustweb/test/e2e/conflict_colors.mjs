// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Conflict colours (wave 23), headless, own vite on a scratch registry (never a live one): the panel's error row and the Approve hint
 * draw the conflicting file and the two features (or branch / main) in their own colours, distinct from the red warning text.
 * Port 5430 (TW_PORT). Run from apps/trustweb:
 *   PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> CHROMIUM_PATH=<headless shell> [TW_SHOTS=<dir>] node test/e2e/conflict_colors.mjs
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checker, waitForServer, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5430)
const base = `http://127.0.0.1:${PORT}/`
const c = checker()
const dir = mkdtempSync(path.join(os.tmpdir(), 'conflict-colors-'))
const registry = path.join(dir, 'ccfix.json')
const bin = path.join(dir, 'preview')
writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o755)
const error = 'wave20/approve-merge: CONFLICT (content): Merge conflict in apps/trustweb/src/dev_preview_rules.ts\nAuto-merging apps/trustweb/vite.config.mjs'
const feature = (key) => ({ key, ref: 'r' + key, branch: 'wave20/' + key, title: 'Feature ' + key, requires: [], selector: '.page-dock', where: 'Home page', steps: ['Dock @ .page-dock'], repo: 'vanilla', checked: true, verdict: 'merge' })
writeFileSync(registry, JSON.stringify({ id: 'ccfix', project: 'tw', short: 'ccfix', created: new Date().toISOString(), base: 'main', baseSha: '9b40711', worktree: dir, branch: 'preview/ccfix', port: PORT, stockPort: PORT + 1, mode: 'personal', features: ['approve-merge', 'map-dots'].map(feature), assembled: { sha: 'aaa1111', at: new Date().toISOString(), error, restart: false } }))

const vite = spawn(process.execPath, [process.env.TW_VITE || path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort', '--port', String(PORT)], {
  cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_PREVIEW: registry, TW_PREVIEW_BIN: bin }, stdio: 'ignore',
})
let browser
try {
  await waitForServer(base)
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  browser = await (pw.chromium ?? pw.default.chromium).launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 860 } })).newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.twp .row.warn .twc-file', { timeout: 15000 })
  const look = (sel) => page.$$eval(sel, (els) => els.map((e) => ({ text: e.textContent, color: getComputedStyle(e).color, warn: getComputedStyle(e.closest('.warn,.hint') ?? e).color })))
  const row = { file: await look('.twp .row.warn .twc-file'), a: await look('.twp .row.warn .twc-a') }
  c.ok('panel: the file is marked', row.file.length === 1 && row.file[0].text === 'apps/trustweb/src/dev_preview_rules.ts', JSON.stringify(row.file))
  c.ok('panel: the branch is marked', row.a.length === 1 && row.a[0].text === 'wave20/approve-merge', JSON.stringify(row.a))
  c.ok('panel: file, branch and warning text: three different colours', new Set([row.file[0].color, row.a[0].color, row.file[0].warn]).size === 3, JSON.stringify(row))
  await page.waitForSelector('.twf-ok .hint .twc-file', { timeout: 15000 })
  const hint = { file: await look('.twf-ok .hint .twc-file'), a: await look('.twf-ok .hint .twc-a') }
  c.ok('Approve hint: file and branch marked in their own colours', hint.file[0]?.text === 'apps/trustweb/src/dev_preview_rules.ts' && hint.a[0]?.text === 'wave20/approve-merge' && hint.file[0].color !== hint.a[0].color, JSON.stringify(hint))
  // the ops status line, as the Approve box shows it after a conflicting press: both features get their own colour
  const status = await page.evaluate(async () => {
    const { statusLine } = await import('/src/dev_feature.ts')
    const body = document.querySelector('.twf-ok .body')
    body.className = 'body warn'; body.replaceChildren(statusLine('conflict in apps/trustweb/src/dev_preview_rules.ts between approve-merge and main'))
    const spans = [...body.querySelectorAll('span')]
    return { rows: body.children.length, tops: new Set(spans.slice(1).map((e) => Math.round(e.getBoundingClientRect().top))).size, spans: spans.map((e) => [e.textContent, getComputedStyle(e).color]) }
  })
  c.ok('Approve status: file, first and second feature, three colours', status.spans.map((s) => s[0]).join('|') === 'apps/trustweb/src/dev_preview_rules.ts|approve-merge|main' && new Set(status.spans.map((s) => s[1])).size === 3, JSON.stringify(status))
  c.ok('Approve status: one line in the box, the two features side by side', status.rows === 1 && status.tops === 1, JSON.stringify(status))
  if (process.env.TW_SHOTS) await page.screenshot({ path: path.join(process.env.TW_SHOTS, 'conflict-colors.png') })
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
console.log(c.failures ? `FAIL ${c.failures}` : `conflict colours: OK (${c.passes})`)
process.exit(c.failures ? 1 : 0)
