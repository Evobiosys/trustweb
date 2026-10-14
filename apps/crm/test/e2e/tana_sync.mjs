/**
 * Live Tana sync proof (dev only): needs the dev server with TW_CRM_TANA_TOKEN and the Tana desktop API on 127.0.0.1:8262.
 * Sets "Nickname" on a test person in the CRM, reads the node back through Tana, clears it, reads again. Prints each request/response (token redacted).
 *   TANA_TOKEN_FILE=~/.pi/tana-token CRM_URL=http://127.0.0.1:5191/ node test/e2e/tana_sync.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const NODE = process.env.TANA_NODE || 'eOW0VvopwvO_'
const NAME = process.env.TANA_NAME || 'Ramakrishna'
const URL = process.env.CRM_URL || 'http://127.0.0.1:5191/'
const token = readFileSync((process.env.TANA_TOKEN_FILE || `${process.env.HOME}/.pi/tana-token`), 'utf8').trim()
const NICK = 'ZpMV4Fqu_0JZ'
const hhmm = new Date().toTimeString().slice(0, 5)
const value = `trustweb-sync-test ${hhmm}`
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
try {
  await page.goto(URL)
  await page.locator('[data-action="toggle-filters"]').click()
  await page.locator('[data-filter="deceased"]').uncheck()
  await page.locator('[data-filter="famous"]').uncheck()
  await page.getByRole('searchbox').fill(NAME)
  await page.locator(`[data-person="tana-${NODE}"], .person-row:has-text("${NAME}")`).first().click()
  await page.locator('[data-action="toggle-fields"]').click()
  await page.locator('[data-action="toggle-advanced"]').click()
  const nick = page.locator(`[data-field="${NICK}"] input`)
  await nick.fill(value)
  await nick.blur()
  await page.waitForTimeout(3000)
  const after = await readNode()
  check(`Tana has "${value}"`, after.includes(value))
  await nick.fill('')
  await nick.blur()
  await page.waitForTimeout(3000)
  const cleared = await readNode()
  check('Tana value gone after clearing', !cleared.includes('trustweb-sync-test'))
  check('no page errors', errors.length === 0)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
