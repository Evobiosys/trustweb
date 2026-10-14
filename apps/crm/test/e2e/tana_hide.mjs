/**
 * Live Tana sync proof (dev only): needs the dev server with TW_CRM_TANA_TOKEN and the Tana desktop API on 127.0.0.1:8262.
 * Hides the test person from TrustWeb in the CRM, reads "hide in trustweb" back from Tana, unhides, reads again. Prints each request/response (token redacted).
 *   TANA_TOKEN_FILE=~/.pi/tana-token CRM_URL=http://127.0.0.1:5191/ node test/e2e/tana_hide.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const NODE = process.env.TANA_NODE || 'eOW0VvopwvO_'
const NAME = process.env.TANA_NAME || 'Ramakrishna'
const URL = process.env.CRM_URL || 'http://127.0.0.1:5191/'
const token = readFileSync((process.env.TANA_TOKEN_FILE || `${process.env.HOME}/.pi/tana-token`), 'utf8').trim()
const redact = (s) => s.split(token).join('<TOKEN>')

let sid = ''
let n = 0
async function rpc(method, params, notify = false) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params })
  const r = await fetch('http://127.0.0.1:8262/mcp', { method: 'POST', body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) } })
  sid = r.headers.get('mcp-session-id') ?? sid
  const text = await r.text()
  console.log(redact(`POST /mcp ${body}\n  -> ${r.status} ${text.trim().slice(0, 400)}`))
  return text
}
async function readNode() {
  return rpc('tools/call', { name: 'read_node', arguments: { nodeId: NODE } })
}

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sync-proof', version: '1' } })
await rpc('notifications/initialized', {}, true)

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const errors = []
page.on('request', (r) => { if (r.url().includes(':8262') && r.postData()?.includes('tools/call')) console.log(redact(`CRM -> ${r.postData()}`)) })
page.on('pageerror', (e) => errors.push(e.message))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const row = page.locator(`.person-row:has-text("${NAME}")`)
try {
  await page.goto(URL)
  await page.locator('[data-action="toggle-filters"]').click()
  await page.locator('[data-filter="deceased"]').uncheck()
  await page.locator('[data-filter="famous"]').uncheck()
  await page.getByRole('searchbox').fill(NAME)
  await row.first().click()
  await page.locator('[data-action="hide-person"]').click()
  check('person gone from the list at once', (await row.count()) === 0)
  await page.waitForTimeout(3500)
  check('Tana has hide in trustweb [X]', /hide in trustweb\*\*:\s*\[[xX]\]/.test(await readNode()))
  await page.locator('[data-tab="settings"], nav >> text=Settings').first().click()
  check('Settings lists it', (await page.locator('[data-part="hidden"]').filter({ hasText: NAME }).count()) === 1)
  await page.locator('[data-part="hidden"]', { hasText: NAME }).locator('[data-action="unhide"]').click()
  await page.waitForTimeout(3500)
  check('Tana has hide in trustweb [ ]', /hide in trustweb\*\*:\s*\[ \]/.test(await readNode()))
  check('no page errors', errors.length === 0)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
