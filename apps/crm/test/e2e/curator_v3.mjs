/**
 * Web Curator v3 proof (dev only, live Tana): needs the 5191 dev server (TW_CRM_RECORD + TW_CRM_TANA_TOKEN) and the Tana API on 127.0.0.1:8262.
 * Intending 0-10 chips, family tag, typed note, collapsed Fields, import in Settings, Alexander Large on the map, and that CRM edits survive
 * a reload AND a dev-server restart (they live in localStorage trustweb-crm.v1.me, not in the seeded record). Cleans the test person's Tana fields.
 *   node test/e2e/curator_v3.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const NODE = 'eOW0VvopwvO_'
const NAME = 'Ramakrishna'
const URL = 'http://127.0.0.1:5191/'
const HOME = process.env.HOME
const T = `${HOME}/Documents/SingularStructure/assets/tana-persons`
const PIDFILE = `${HOME}/.cache/trustweb-dev/vite-5191-tana.pid`
const LOG = `${HOME}/.cache/trustweb-dev/vite-5191-tana.log`
const token = readFileSync(`${HOME}/.pi/tana-token`, 'utf8').trim()

let sid = ''
let n = 0
async function rpc(method, params, notify = false) {
  const r = await fetch('http://127.0.0.1:8262/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) } })
  sid = r.headers.get('mcp-session-id') ?? sid
  return r.text()
}
const tool = (name, args) => rpc('tools/call', { name, arguments: args })
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'curator-proof', version: '1' } })
await rpc('notifications/initialized', {}, true)

function startServer() {
  const out = openSync(LOG, 'w')
  const child = spawn('node', ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', '5191', '--strictPort'], {
    detached: true, stdio: ['ignore', out, out], env: { ...process.env, TW_CRM_RECORD: `${T}/record.json`, TW_CRM_TANA_TOKEN: token },
  })
  child.unref()
  writeFileSync(PIDFILE, String(child.pid))
}
async function restartServer() {
  process.kill(Number(readFileSync(PIDFILE, 'utf8')))
  await new Promise((r) => setTimeout(r, 1500))
  startServer()
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(URL)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not come back')
}

const profile = mkdtempSync(path.join(tmpdir(), 'curator-profile-'))
const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const row = () => page.locator(`.person-row:has-text("${NAME}")`).first()
const pressed = (n) => page.locator(`[data-intending="${n}"]`).getAttribute('aria-pressed')
const waitTana = async (re) => { for (let i = 0; i < 20; i++) { const t = await tool('read_node', { nodeId: NODE }); if (re.test(t)) return t; await page.waitForTimeout(500) } return tool('read_node', { nodeId: NODE }) }

try {
  await page.goto(URL)
  await page.getByRole('searchbox').waitFor()
  check('title Web Curator, heading Contacts', (await page.title()) === 'Web Curator' && (await page.locator('h1').innerText()) === 'Contacts')
  check('import is not in the header', (await page.locator('header.top input[type=file]').count()) === 0)
  const heads = await page.locator('h3.ring-heading').allInnerTexts()
  console.log('headings:', heads.join(' | '))
  check('Alexander Large on the map under Intending to connect', await page.locator('.person-row:has-text("Alexander Large")').count() > 0 && heads.some((h) => /intending to connect \(1\)/i.test(h)))
  check('ring order close/friend/acquaintance/intending (unplaced sit in a collapsed list)', ['Friend', 'Intending to connect'].every((x, i) => heads.findIndex((h) => h.toLowerCase().startsWith(x.toLowerCase())) >= 0 && (i === 0 || heads.findIndex((h) => h.toLowerCase().startsWith(x.toLowerCase())) > heads.findIndex((h) => h.toLowerCase().startsWith(['friend', 'intending to connect'][i - 1])))))

  await page.locator('[data-action="toggle-filters"]').click()
  await page.locator('[data-filter="deceased"]').uncheck()
  await page.locator('[data-filter="famous"]').uncheck()
  await page.getByRole('searchbox').fill(NAME)
  await row().locator('.pr-open').click()
  check('fields collapsed under a toggle', (await page.locator('[data-slot]').count()) === 0 && /Fields \(\d+\)/.test(await page.locator('[data-action="toggle-fields"]').innerText()))
  await page.locator('[data-intending="3"]').click()
  check('chip 3 pressed', (await pressed(3)) === 'true')
  check('ring is now Intending to connect', /Intending to connect/.test(await page.locator('[data-action="ring-label"]').innerText()))
  await page.locator('[data-action="ring-label"]').click()
  await page.locator('[data-choice="family"]').click()
  check('family dot shows', (await page.locator('[data-part="family"]').count()) === 1)
  await page.fill('[data-field="add-note"]', 'curator v3 e2e note')
  await page.locator('[data-action="add-note"]').click()
  const t1 = await waitTana(/\(0-10\)\*\*: 3[\s\S]*intending since\*\*: (Today|\d{4})/)
  check('Tana has the desire 3', /intending to connect \(0-10\)\*\*: 3/.test(t1))
  check('Tana has the since date', /intending since\*\*: (Today|\d{4}-\d{2}-\d{2})/.test(t1))
  const t2 = await waitTana(/curator v3 e2e note/)
  check('Tana Notes from TrustWeb has the dated line', /\d{4}-\d{2}-\d{2} curator v3 e2e note/.test(t2))

  await page.reload()
  await page.getByRole('searchbox').fill(NAME)
  await row().locator('.pr-open').click()
  check('after reload: desire 3 kept', (await pressed(3)) === 'true')
  await restartServer()
  await page.waitForTimeout(1500)
  await page.goto(URL)
  await page.getByRole('searchbox').fill(NAME)
  await row().locator('.pr-open').click()
  check('after server restart + reload: desire 3 kept', (await pressed(3)) === 'true')
  check('after server restart + reload: family dot kept', (await page.locator('[data-part="family"]').count()) === 1)

  await page.locator('[data-intending="0"]').click()
  await page.locator('[data-action="ring-label"]').click()
  await page.locator('[data-choice="family"]').click()
  await page.getByRole('button', { name: /^←/ }).click()
  await page.locator('[data-tab="settings"]').click()
  check('Import a TrustWeb export sits in Settings', (await page.locator('[data-screen="settings"] input[type=file]').count()) === 1)
  await page.waitForTimeout(3000)
} catch (e) {
  console.log('ERROR', e.message)
  failed = true
}
// leave the test person clean in Tana: number 0, notes field emptied
await tool('set_field_content', { nodeId: NODE, attributeId: 'IVe9VSySDcS1', content: null, mode: 'replace' })
await tool('set_field_content', { nodeId: NODE, attributeId: 'LNlpliq4GdNI', content: '[ ]', mode: 'replace' })
console.log('Tana test person after cleanup:', (await tool('read_node', { nodeId: NODE })).replace(/\s+/g, ' ').slice(0, 400))
check('0 page errors', errors.length === 0)
if (errors.length) console.log(errors)
await ctx.close()
process.exit(failed ? 1 : 0)
