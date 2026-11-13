// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity proof (headless, synthetic record in /tmp): an MCP call from a real stdio client shows in the open personal preview as a card within ~1 s.
 *   PORT=5420 EXE=<chromium headless shell> PW=<playwright-core index.js> SHOTS=<dir> node mcp_parity.mjs
 * Starts its own dev server (TW_DEV_RECORD seed + TW_DEV_LIVE in /tmp) and its own MCP child; stops both at the end.
 * Covers: record card (Apply, Undo), action card (app_action set-look, Apply), "MCP applies directly" (no card), the copy commands with the absolute path, no overlap.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW = path.resolve(HERE, '../..')
const SERVER = path.resolve(TW, '../mcp/src/server.ts')
const VITE = path.resolve(TW, '../crm/node_modules/vite/bin/vite.js')
const PORT = process.env.PORT ?? 5420
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.SHOTS ?? '/tmp'
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
let failed = false
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? `  (${extra})` : ''}`); if (!cond) failed = true }
const HIDE = '.twf, .twf-ok, .twp { display: none !important }'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const meet = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcp-e2e-'))
const NOW = Date.now()
const record = { v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people: [
  { id: 'p1', name: 'Bo Tester', ring: 'close', lines: [], context: '', metAt: NOW, fields: {} },
  { id: 'p2', name: 'Cy Sample', ring: 'friend', lines: [], context: '', metAt: NOW, fields: {} },
] }
const seed = path.join(dir, 'seed.json'); const live = path.join(dir, 'live.json')
writeFileSync(seed, JSON.stringify(record)); writeFileSync(live, JSON.stringify(record))
const liveRec = () => JSON.parse(readFileSync(live, 'utf8'))

const vite = spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: TW, env: { ...process.env, TW_DEV_RECORD: seed, TW_DEV_LIVE: live, TW_PORT: String(PORT) }, stdio: 'ignore' })

/** A minimal stdio MCP client: one child per run, JSON lines. */
function mcpClient() {
  const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SERVER], { env: { ...process.env, TW_RECORD: live, TW_MCP_WRITE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''; const waiting = new Map(); let id = 0
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id) } catch { /* ignore */ } } })
  const call = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  return {
    init: async () => { await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n') },
    tool: (name, args) => call('tools/call', { name, arguments: args }),
    list: async () => (await call('tools/list', {})).result.tools.map((t) => t.name),
    stop: () => child.kill(),
  }
}

let browser; let mcp
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break } catch { /* not up */ } await sleep(300) }
  browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
  mcp = mcpClient(); await mcp.init()
  const tools = await mcp.list()
  check('the server lists the parity tools', ['set_ring', 'remove_tag', 'set_field', 'create_group_tag', 'app_action', 'settings_set'].every((t) => tools.includes(t)))

  const info = await (await fetch(BASE + '/__tw/mcp-info')).json()
  check('mcp-info names the absolute server path of this checkout', info.server === SERVER && info.server.startsWith('/') && !info.server.includes('/path/to'), JSON.stringify(info))
  check('mcp-info names the live file (TW_DEV_LIVE is set)', info.record === live)

  for (const [tag, vp] of [['1280', { width: 1280, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    page.on('domcontentloaded', () => { void page.addStyleTag({ content: HIDE }).catch(() => {}) })   // the dev slot's own approve box is not part of the app
    await page.goto(BASE + '/'); await page.waitForTimeout(3000)
    const names = () => page.evaluate(() => (JSON.parse(localStorage.getItem('trustweb.v1.me') ?? '{}').people ?? []).map((p) => `${p.name}:${p.ring}`))
    check(`${tag}: the page booted with the seed`, (await names()).includes('Bo Tester:close'), String(await names()))
    await page.waitForTimeout(1500)   // the first poll has fixed the cursor

    // 1. a record change by MCP -> a card within ~1 s
    const t0 = Date.now()
    await mcp.tool('set_ring', { person: 'Bo Tester', ring: 'friend' })
    await page.locator('[data-mcp-apply]').waitFor({ timeout: 4000 })
    const took = Date.now() - t0
    check(`${tag}: the card shows within 1.5 s of the MCP call`, took < 1500, `${took} ms`)
    const card = await page.locator('[data-mcp-apply]').evaluate((b) => b.closest('div')?.parentElement?.innerText ?? '')
    check(`${tag}: the card names the change`, /An agent changed your web/.test(card) && /set_ring/.test(card), card.slice(0, 120))
    // no control lies over another: the card against the header gear and the bottom bar
    const cardBox = await page.locator('[data-mcp-apply]').evaluate((b) => { const c = b.closest('.notice, [class*="friends"], div'); const r = (b.closest('[role]') ?? c).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    for (const sel of ['[data-settings-gear]', '.tabs']) {
      const o = await page.locator(sel).first().boundingBox().catch(() => null)
      if (o) check(`${tag}: the card does not lie over ${sel}`, !meet(cardBox, o), JSON.stringify({ cardBox, o }))
    }
    await page.screenshot({ path: `${SHOTS}/mcp-parity-card-${tag}.png` })
    check(`${tag}: before Apply the page still has the old ring`, (await names()).includes('Bo Tester:close'))
    await Promise.all([page.waitForNavigation({ timeout: 8000 }), page.locator('[data-mcp-apply]').first().click()])
    await page.waitForTimeout(2500)
    check(`${tag}: Apply takes the agent's change into the page`, (await names()).includes('Bo Tester:friend'), String(await names()))

    // 2. Undo puts this page's record back over the file
    await mcp.tool('set_ring', { person: 'Cy Sample', ring: 'acquaintance' })
    await page.locator('[data-mcp-undo]').waitFor({ timeout: 4000 })
    await page.locator('[data-mcp-undo]').first().click()
    await page.waitForTimeout(3500)
    check(`${tag}: Undo restores the file to this page's record`, liveRec().people.find((p) => p.id === 'p2').ring === 'friend', JSON.stringify(liveRec().people.map((p) => p.ring)))

    // 3. a step only the app can do -> card -> Apply runs it through the registry
    await mcp.tool('app_action', { type: 'set-look', args: { look: 'sleek' }, why: 'try the calm look' })
    await page.locator('[data-mcp-apply]').waitFor({ timeout: 4000 })
    const acard = await page.locator('[data-mcp-apply]').evaluate((b) => b.closest('div')?.parentElement?.innerText ?? '')
    check(`${tag}: the action card reads in plain words`, /asks for a step/.test(acard) && /look/i.test(acard), acard.slice(0, 160))
    await page.locator('[data-mcp-apply]').first().click(); await page.waitForTimeout(600)
    check(`${tag}: Apply ran set-look (html[data-look=sleek])`, (await page.evaluate(() => document.documentElement.getAttribute('data-look'))) === 'sleek')
    await page.locator('.toast').first().click({ timeout: 3000 }); await page.waitForTimeout(400)
    check(`${tag}: the toast Undo took the look back`, (await page.evaluate(() => document.documentElement.getAttribute('data-look'))) !== 'sleek')

    // 4. a bad action shows its error and nothing else
    await mcp.tool('app_action', { type: 'set-look', args: { look: 'neon' } })
    await page.locator('[data-mcp-dismiss]').waitFor({ timeout: 4000 })
    check(`${tag}: a bad action says why`, /cannot be done/.test(await page.locator('[data-mcp-dismiss]').evaluate((b) => b.closest('div')?.parentElement?.innerText ?? '')))
    await page.locator('[data-mcp-dismiss]').first().click()

    // 5. MCP applies directly: switch it on through MCP, apply once, then no card
    await mcp.tool('settings_set', { id: 'mcp.applyDirectly', value: true })
    await page.locator('[data-mcp-apply]').waitFor({ timeout: 4000 })
    await Promise.all([page.waitForNavigation({ timeout: 8000 }), page.locator('[data-mcp-apply]').first().click()])
    await page.waitForTimeout(3000)
    check(`${tag}: the switch arrived in the page's record`, (await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).mcpApplyDirectly)) === true)
    await mcp.tool('app_action', { type: 'set-look', args: { look: 'dex' } })
    await page.waitForTimeout(1800)
    check(`${tag}: direct mode ran the step with no card`, (await page.locator('[data-mcp-apply]').count()) === 0 && (await page.evaluate(() => document.documentElement.getAttribute('data-look'))) === 'dex')
    const navs = page.waitForNavigation({ timeout: 8000 })
    await mcp.tool('set_ring', { person: 'Bo Tester', ring: 'closest' })
    await navs; await page.waitForTimeout(2500)
    check(`${tag}: direct mode took the record change at once`, (await names()).includes('Bo Tester:closest'), String(await names()))
    await page.screenshot({ path: `${SHOTS}/mcp-parity-direct-${tag}.png` })

    // 6. Settings: the commands with the absolute path and a copy button each
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-settings-advanced-all] > summary').click(); await page.waitForTimeout(400)
    await page.locator('[data-settings-group="general"] > summary').first().click(); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"] > summary').first()
    await ext.scrollIntoViewIfNeeded(); await ext.click(); await page.waitForTimeout(300)
    if (!(await page.locator('[data-mcp-settings]').count())) { await page.locator('[data-ext-module="mcp-local"]').click(); await page.waitForTimeout(1500) }
    check(`${tag}: the direct switch is in MCP settings`, (await page.locator('[data-mcp-direct][aria-checked="true"]').count()) === 1)
    check(`${tag}: with writes off the page says so next to the commands`, (await page.locator('[data-mcp-writes-off]').count()) === 1)
    await page.locator('[data-mcp-write]').click(); await page.waitForTimeout(300)
    const snip = page.locator('[data-mcp-snippet="pi"]')
    if (await snip.count()) {
      const text = await snip.first().innerText()
      check(`${tag}: the pi command is one line, absolute, with the live file`, text.startsWith('pi mcp add trustweb --env TW_MCP_WRITE=1') && text.includes(SERVER) && text.includes(`TW_RECORD=${live}`) && !text.includes('/path/to') && !text.includes('\n'), text)
      const cc = await page.locator('[data-mcp-snippet="claude-code"]').first().innerText()
      check(`${tag}: the Claude Code command starts claude mcp add and has the path`, cc.startsWith('claude mcp add trustweb') && cc.includes(SERVER), cc)
      check(`${tag}: pi shows its fallback text`, (await page.locator('[data-mcp-snippet="pi-fallback"]').first().innerText()).startsWith('Tell pi: add this to ~/.pi/agent/mcp.json'))
      check(`${tag}: each command has a copy button`, (await page.locator('[data-mcp-copy="pi"]').count()) === 1 && (await page.locator('[data-mcp-copy="claude-code"]').count()) === 1)
      await snip.first().scrollIntoViewIfNeeded().catch(() => {})
      await page.screenshot({ path: `${SHOTS}/mcp-parity-settings-${tag}.png` })
    } else check(`${tag}: the MCP settings section opened`, false, 'no [data-mcp-snippet=pi]')
    await ctx.close()
    // reset the shared files for the second viewport
    writeFileSync(live, JSON.stringify(record))
  }
} catch (e) { console.log('ERROR', e?.stack ?? e); failed = true }
finally { mcp?.stop(); await browser?.close(); vite.kill() }
process.exit(failed ? 1 : 0)
