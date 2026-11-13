// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Review panel (wave 42), headless, own vite on a scratch registry and a fake `preview` CLI (never a live registry):
 *   B12 flat rows + "after" chip, B03 state glyphs, B06/P06 no two buttons overlap (collapsed, expanded, working, failed) at 360 and 1280,
 *   B14 the Approve wave box returns at once after the last approve, B01 "Mark as merged" / conflict line + fix button, F11 pop-out window.
 * Port 5414 (TW_PORT). Run from apps/trustweb:
 *   PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> CHROMIUM_PATH=<headless shell> TW_VITE=<vite.js> node test/e2e/review_panel.mjs
 * Screens: TW_SHOTS=<dir> (DEVLOG/wave42/screens/review-panel-*.png).
 */
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checker, waitForServer, TW_ROOT } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 5414)
const SHOTS = process.env.TW_SHOTS
const base = `http://127.0.0.1:${PORT}/`
const c = checker()
const dir = mkdtempSync(path.join(os.tmpdir(), 'review-panel-'))
const registry = path.join(dir, 'rpfix.json')
const gateFile = path.join(dir, 'gate.json')
const slowFile = path.join(dir, 'slow')
const logFile = path.join(dir, 'calls.log')
const bin = path.join(dir, 'preview')
writeFileSync(bin, `#!${process.execPath}
const fs = require('fs')
const [id, cmd, ...a] = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logFile)}, [cmd, ...a].join(' ') + '\\n')
const reg = JSON.parse(fs.readFileSync(${JSON.stringify(registry)}, 'utf8'))
const row = (k) => reg.features.find((f) => f.key === k)
if (cmd === 'gate') { try { const g = fs.readFileSync(${JSON.stringify(gateFile)}, 'utf8'); console.log(g.trim()); process.exit(JSON.parse(g).ok ? 0 : 1) } catch { process.exit(1) } }
if (cmd === 'verdict') { if (fs.existsSync(${JSON.stringify(slowFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); row(a[0]).verdict = a[1] === 'clear' ? null : a[1] }
if (cmd === 'toggle') row(a[0]).checked = a[1] === 'on'
if (cmd === 'mark-merged') { row(a[0]).merged = true; reg.assembled.error = null; try { fs.unlinkSync(${JSON.stringify(gateFile)}) } catch {} }
fs.writeFileSync(${JSON.stringify(registry)}, JSON.stringify(reg))
`)
chmodSync(bin, 0o755)
// A build with the ops fix-conflict route (wave 42 ops-cicd) would launch a real pi session: point it at a stub and a scratch DEVLOG.
const devlog = path.join(dir, 'DEVLOG')
mkdirSync(path.join(devlog, 'wave1'), { recursive: true })
const newSession = path.join(dir, 'new_session.sh')
writeFileSync(newSession, `#!/bin/sh\necho "$@" >> ${logFile}.session\necho "LAUNCHED window 1"\n`)
chmodSync(newSession, 0o755)

const feature = (key, over = {}) => ({ key, ref: 'r' + key, branch: 'wave41/' + key, title: key, requires: [], selector: '.page-dock', where: 'Home page', steps: [], repo: 'vanilla', checked: true, verdict: null, ...over })
const features = () => [feature('keyring-di-export'), feature('review-fixes-41', { requires: ['keyring-di-export'] }), feature('ai-subscription', { branch: 'wave36/ai-subscription', checked: false })]
const reg = (over = {}) => ({ id: 'rpfix', project: 'tw', short: 'rpfix', created: new Date().toISOString(), base: 'main', baseSha: '0379fb8', worktree: dir, branch: 'preview/rpfix', port: PORT, stockPort: PORT + 1, mode: 'personal', features: features(), assembled: { sha: 'aaa1111', at: new Date().toISOString(), error: null, restart: false }, ...over })
const write = (over) => { writeFileSync(registry, JSON.stringify(reg(over))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const calls = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')

write()
const vite = spawn(process.execPath, [process.env.TW_VITE || path.join(TW_ROOT, '../crm/node_modules/vite/bin/vite.js'), '--strictPort', '--port', String(PORT)], {
  cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(PORT), TW_PREVIEW: registry, TW_PREVIEW_BIN: bin, TW_DEVLOG: devlog, TW_NEW_SESSION: newSession }, stdio: 'ignore',
})
let browser
/** Every visible button of the panel and the Approve box: pairs whose boxes intersect by more than 1 px in both directions. */
const overlaps = (page) => page.evaluate(() => {
  // A panel button scrolled out of the panel's own window (clipped by its overflow) is not on screen: its box is cut to the panel's.
  const box = (b) => {
    const r = b.getBoundingClientRect(), p = b.closest('.twp')?.getBoundingClientRect()
    return p ? { left: Math.max(r.left, p.left), right: Math.min(r.right, p.right), top: Math.max(r.top, p.top), bottom: Math.min(r.bottom, p.bottom) } : r
  }
  const vis = [...document.querySelectorAll('.twp button, .twf-ok button')].filter((b) => {
    const r = box(b), cs = getComputedStyle(b)
    return r.right - r.left > 0 && r.bottom - r.top > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !b.closest('[hidden]') && r.bottom > 0 && r.top < innerHeight
  })
  const out = []
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = box(vis[i]), b = box(vis[j])
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push((vis[i].textContent || vis[i].title || vis[i].className).trim().slice(0, 20) + ' x ' + (vis[j].textContent || vis[j].title || vis[j].className).trim().slice(0, 20))
  }
  return { n: vis.length, out }
})
try {
  await waitForServer(base)
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  browser = await (pw.chromium ?? pw.default.chromium).launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    console.log(`== ${w}x${h}`)
    write(); await sleep(100)
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-panel-${name}-${w}.png` }) }
    await page.goto(base); await page.waitForSelector('.twp header', { timeout: 20_000 })
    const openLoad = async () => { if (!(await page.locator('.twp .feat').count())) { await page.locator('.twp .loadhead').click(); await page.waitForSelector('.twp .feat') } }
    await openLoad()

    console.log('B12 flat rows')
    const xs = await page.evaluate(() => [...document.querySelectorAll('.twp .feat')].map((e) => Math.round(e.getBoundingClientRect().left)))
    c.ok('three rows, one left edge, no nesting', xs.length === 3 && new Set(xs).size === 1 && (await page.locator('.twp .kids').count()) === 0, JSON.stringify(xs))
    c.ok('"after keyring-di-export" chip on the dependent row', (await page.locator('.twp .after', { hasText: 'after keyring-di-export' }).count()) === 1)

    console.log('B03 glyphs')
    const glyphs = () => page.locator('.twp .feat .state').allTextContents()
    c.ok('to review = ⬜️ on every row', JSON.stringify(await glyphs()) === JSON.stringify(['⬜️', '⬜️', '⬜️']), JSON.stringify(await glyphs()))

    console.log('B06/P06 overlap')
    let o = await overlaps(page)
    c.ok(`expanded: ${o.n} buttons, none overlap`, o.n > 6 && o.out.length === 0, o.out.join('; '))
    const hdr = await page.evaluate(() => { const hb = document.querySelector('.twp .hbtns').getBoundingClientRect(), sa = [...document.querySelectorAll('.twp button')].find((b) => /Select (all|none)/.test(b.textContent)).getBoundingClientRect(), hd = document.querySelector('.twp header').getBoundingClientRect(); return { strip: hb.height, selBelow: sa.top >= hd.bottom - 1, btnsInHeader: [...document.querySelectorAll('.twp .hbtns button')].every((b) => b.getBoundingClientRect().bottom <= hd.bottom + 1) } })
    c.ok('button strip is 44 px; Select all sits below the header', hdr.strip === 44 && hdr.selBelow && hdr.btnsInHeader, JSON.stringify(hdr))
    await shot('expanded')
    // working: a slow verdict keeps the panel busy
    writeFileSync(slowFile, '1')
    await page.locator('.twp .feat').first().locator('.pill.merge').click()
    await page.waitForSelector('.twp header .clk', { timeout: 8000 })
    o = await overlaps(page)
    c.ok(`working: ${o.n} buttons, none overlap`, o.out.length === 0, o.out.join('; '))
    c.ok('the working text and the id stay inside the header', await page.evaluate(() => { const hd = document.querySelector('.twp header').getBoundingClientRect(), hl = document.querySelector('.twp .hl').getBoundingClientRect(), hb = document.querySelector('.twp .hbtns').getBoundingClientRect(); return hl.right <= hb.left + 1 && hl.bottom <= hd.bottom + 1 }))
    await shot('working')
    await page.waitForFunction(() => !document.querySelector('.twp header .clk'), null, { timeout: 15_000 })
    await sleep(500)
    try { unlinkSync(slowFile) } catch { /* gone */ }
    c.ok('B03: approved row shows ✅', (await glyphs())[0] === '✅', JSON.stringify(await glyphs()))
    // failed: an assembly error
    write({ features: JSON.parse(readFileSync(registry, 'utf8')).features, assembled: { sha: 'bbb2222', at: new Date().toISOString(), error: 'wave41/review-fixes-41: CONFLICT (content): Merge conflict in src/main.ts\nsecond line', restart: false } })
    await page.waitForSelector('.twp .conf', { timeout: 10_000 })
    o = await overlaps(page)
    c.ok(`failed: ${o.n} buttons, none overlap`, o.out.length === 0, o.out.join('; '))
    c.ok('B01 without gate fields: first conflict line + details + fix button, no mark-merged', (await page.locator('.twp .conf', { hasText: 'Fix the conflict first: wave41/review-fixes-41: CONFLICT' }).count()) === 1 && (await page.locator('.twp .conf details summary').count()) === 1 && (await page.locator('[data-fix-conflict]').count()) === 1 && (await page.locator('[data-mark-merged]').count()) === 0)
    await shot('failed')
    const sessionsBefore = existsSync(`${logFile}.session`) ? readFileSync(`${logFile}.session`, 'utf8').trim().split('\n').filter(Boolean).length : 0
    await page.locator('[data-fix-conflict]').click()
    await page.waitForFunction(() => document.querySelector('.twp-toast')?.textContent.includes('not available') || document.querySelector('[data-fix-conflict]')?.disabled, null, { timeout: 5000 })
    // Review wave 42: this build has the route, so the STUB launcher (never pi_new_session.sh) must have run once and the panel names the window.
    c.ok('B16: the fix button ran the stub launcher once (no real pi session) and shows the started session', (await page.locator('[data-fix-conflict]').isDisabled()) && (await page.locator('.twp .launched').textContent()).includes('1') && readFileSync(`${logFile}.session`, 'utf8').trim().split('\n').filter(Boolean).length === sessionsBefore + 1 && existsSync(path.join(devlog, 'wave1', 'conflict-review-fixes-41.txt')), `launched=${await page.locator('.twp .launched').textContent().catch(() => '-')} sessions=${existsSync(`${logFile}.session`) ? readFileSync(`${logFile}.session`, 'utf8') : '-'}`)
    // collapsed
    await page.keyboard.press('Escape'); await sleep(200)
    o = await overlaps(page)
    c.ok('collapsed: no overlap', o.out.length === 0, o.out.join('; '))
    await page.keyboard.press('Escape')
    await ctx.close()
  }

  console.log('== B01 mark merged, B14, F11 (360x780)')
  {
    const f = features(); f[2].verdict = 'merge'
    writeFileSync(gateFile, JSON.stringify({ ok: false, hint: 'ai-subscription is already in main (PR #61): mark it merged', kind: 'squashed-in-main', action: 'mark-merged ai-subscription' }))
    write({ features: f.map((x) => ({ ...x, checked: x.key === 'ai-subscription' || x.checked })), assembled: { sha: 'ccc3333', at: new Date().toISOString(), error: 'wave36/ai-subscription: CONFLICT (content): Merge conflict in src/main.ts', restart: false } })
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } })
    const page = await ctx.newPage()
    await page.goto(base); await page.waitForSelector('.twp header', { timeout: 20_000 })
    await page.waitForSelector('[data-mark-merged]', { timeout: 15_000 })
    c.ok('B01: one-tap "Mark as merged" instead of the raw conflict', (await page.locator('.twp .conf').textContent()).includes('already in main') && (await page.locator('[data-fix-conflict]').count()) === 0)
    await page.locator('[data-mark-merged]').click()
    await page.waitForSelector('[data-mark-merged]', { state: 'detached', timeout: 15_000 })
    c.ok('the tap ran `mark-merged ai-subscription` and the conflict line is gone', calls().includes('mark-merged ai-subscription') && (await page.locator('.twp .conf').count()) === 0, calls())

    // Review wave 42: a busy project (launcher exit 3) answers 409 with one sentence; the panel shows it, nothing launches.
    writeFileSync(newSession, `#!/bin/sh\necho "refused: another session of trustweb is ACTIVE: pi261112z"\nexit 3\n`)
    const before = existsSync(`${logFile}.session`) ? readFileSync(`${logFile}.session`, 'utf8') : ''
    write({ features: JSON.parse(readFileSync(registry, 'utf8')).features, assembled: { sha: 'ddd4444', at: new Date().toISOString(), error: 'wave41/keyring-di-export: CONFLICT (content): Merge conflict in src/x.ts', restart: false } })
    await page.waitForSelector('[data-fix-conflict="keyring-di-export"]', { timeout: 15_000 })
    await page.locator('[data-fix-conflict="keyring-di-export"]').click()
    await page.waitForFunction(() => [...document.querySelectorAll('.twp .row.warn')].some((n) => n.textContent.includes('Another pi session')), null, { timeout: 10_000 }).catch(() => {})
    c.ok('busy project: 409 sentence "Another pi session of this project is active (pi261112z)" shown, button stays usable', (await page.locator('.twp .row.warn', { hasText: 'Another pi session of this project is active (pi261112z)' }).count()) === 1 && !(await page.locator('[data-fix-conflict="keyring-di-export"]').isDisabled()) && (existsSync(`${logFile}.session`) ? readFileSync(`${logFile}.session`, 'utf8') : '') === before)
    writeFileSync(newSession, `#!/bin/sh\necho "$@" >> ${logFile}.session\necho "LAUNCHED window 1"\n`)
    write({ features: JSON.parse(readFileSync(registry, 'utf8')).features, assembled: { sha: 'eee5555', at: new Date().toISOString(), error: null, restart: false } })
    await page.waitForSelector('.twp .conf', { state: 'detached', timeout: 15_000 }).catch(() => {})

    // Review wave 42 (ops step d): a red CI on the PR (approvals status "failed", "CI failed on PR #n") survives a reload and offers
    // "Re-run the failed checks" -> POST /rerun-failed -> `preview <id> rerun-failed` (the stub CLI; nothing is pushed). The status is mocked in the page.
    {
      const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 } })
      const p2 = await ctx2.newPage()
      await p2.route('**/__tw/status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ step: 'failed', text: 'CI failed on PR #90: unit (re-running the failed jobs once)', pr: 90, updated: new Date().toISOString() }) }))
      await p2.goto(base); await p2.waitForSelector('.twp header', { timeout: 20_000 })
      await p2.locator('.twp header').click().catch(() => {})
      const shown = await p2.waitForSelector('[data-rerun-failed]', { timeout: 15_000 }).then(() => true, () => false)
      { const o = await overlaps(p2); c.ok(`red CI: "Re-run the failed checks" shown after a reload, ${o.n} buttons, none overlap`, shown && o.out.length === 0, o.out.join('; ')) }
      if (shown) {
        if (SHOTS) await p2.screenshot({ path: `${SHOTS}/review-panel-rerun-failed-360.png` })
        await p2.locator('[data-rerun-failed]').click()
        for (let i = 0; i < 50 && !calls().includes('rerun-failed'); i++) await sleep(100)
      }
      c.ok('red CI: the tap ran `rerun-failed` (stub)', calls().includes('rerun-failed'), calls())
      await ctx2.close()
    }

    // B14: focus mode on row a, approve a (jumps to b), approve b: the box returns
    write()
    await ctx.clearCookies()
    const p2 = await ctx.newPage()
    await p2.addInitScript(() => { if (!sessionStorage.getItem('seed')) { sessionStorage.setItem('seed', '1'); sessionStorage.setItem('twp-focus-rpfix', JSON.stringify('keyring-di-export')) } })
    await p2.goto(base); await p2.waitForSelector('.twp .feat', { timeout: 20_000 })
    const compact = () => p2.evaluate(() => document.documentElement.classList.contains('twp-compact'))
    c.ok('B14: focus mode hides the Approve wave box', await compact())
    await p2.locator('.twp .pill.merge').first().click()
    await p2.waitForFunction(() => document.querySelectorAll('.twp .feat').length === 1 && /review-fixes-41/.test(document.querySelector('.twp .feat').textContent), null, { timeout: 15_000 })
    c.ok('after the first approve the box is still hidden (a row waits)', await compact())
    await p2.locator('.twp .pill.merge').first().click()
    await p2.waitForFunction(() => !document.documentElement.classList.contains('twp-compact'), null, { timeout: 5000 })
    c.ok('B14: the last approve shows the Approve wave box at once', !(await compact()) && await p2.locator('.twf-ok .go.big').isVisible())
    if (SHOTS) await p2.screenshot({ path: `${SHOTS}/review-panel-approve-box-360.png` })
    await p2.close()

    // F11: pop-out
    const main = await ctx.newPage()
    await main.goto(base); await main.waitForSelector('.twp header', { timeout: 20_000 })
    const [pop] = await Promise.all([ctx.waitForEvent('page'), main.locator('[data-panel-popout]').click()])
    await pop.waitForSelector('.twp header', { timeout: 20_000 })
    await main.waitForFunction(() => document.querySelector('.twp')?.hidden === true, null, { timeout: 8000 })
    c.ok('F11: the pop-out shows the panel, the main window hides its inline panel', (await pop.locator('.twp').isVisible()) && (await main.locator('.twp').isHidden()))
    c.ok('the pop-out has no pop-out button of its own', (await pop.locator('[data-panel-popout]').count()) === 0)
    await pop.close()
    await main.waitForFunction(() => document.querySelector('.twp')?.hidden === false, null, { timeout: 8000 })
    c.ok('F11: closing the pop-out gives the panel back', await main.locator('.twp').isVisible())
    await ctx.close()
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
console.log(c.failures ? `FAIL ${c.failures}` : `review panel: OK (${c.passes})`)
process.exit(c.failures ? 1 : 0)
