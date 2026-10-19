/**
 * Wave 7 proof, dev only, live Tana: one ring store. Needs the personal preview started WITH TW_CRM_TANA_TOKEN (scripts/tw_dev.sh) and the Tana API on 127.0.0.1:8262.
 *   PORT=5192 node test/e2e/one_ring_store.mjs
 * Manuel Spornberger shows one ring in the Curator list and on the Web rings; a ring set in the Curator moves the person on the Web view (no reload),
 * lands in trustweb.v1.me only (not in the Curator's key) and in Tana (ring option + approved [X]); Ramakrishna is reset in Tana afterwards.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5192}/`
const NODE = 'eOW0VvopwvO_'
const PID = `tana-${NODE}`
const MANUEL = 'tana-iHgGDVKE6vGG'
const OPT = { unsorted: 'THYXz_h9_MSf', friend: 'L3O_fhbzNg3H', acquaintance: '5g0_ijoSfbqA', 'close friend': 'ODC_KVcWiMTS' }
const token = readFileSync(`${process.env.HOME}/.pi/tana-token`, 'utf8').trim()
let sid = ''
let n = 0
async function rpc(method, params, notify = false) {
  const r = await fetch('http://127.0.0.1:8262/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) } })
  sid = r.headers.get('mcp-session-id') ?? sid
  return r.text()
}
const tool = (name, args) => rpc('tools/call', { name, arguments: args })
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'one-ring-proof', version: '1' } })
await rpc('notifications/initialized', {}, true)
const ringLine = (t) => /ring in TrustWeb\*?\*?:\s*\[?([a-z ]+)/i.exec(t)?.[1]?.trim()
const approved = (t) => /ring approved\*?\*?:\s*\[X\]/i.test(t)
const before = await tool('read_node', { nodeId: NODE })
console.log('Tana before:', ringLine(before), approved(before) ? '[X]' : '[ ]')

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'one-ring-')), { headless: true, viewport: { width: 390, height: 844 }, args: ['--use-mock-keychain', '--password-store=basic'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
// A fresh profile would first push the suggested rings of all people to Tana (once per device); this one has done that already, so the test edit goes out at once.
const ids = JSON.parse(readFileSync(`${process.env.HOME}/Documents/SingularStructure/assets/tana-persons/trustweb-record.json`, 'utf8')).people.map((p) => p.id)
await page.addInitScript(({ ids, token }) => {
  if (!localStorage.getItem('trustweb-crm.v1.prefs')) localStorage.setItem('trustweb-crm.v1.prefs', JSON.stringify({ pkms: ['tana'], token, autoSync: true, ringQueued: ids, suggestedQueued: ids }))
}, { ids, token })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
/** Distance of a person's circle from the centre of the Web rings, and the ring that distance belongs to. */
const radius = (id) => page.evaluate((pid) => {
  const b = document.querySelector(`.rings-wrap [data-pid="${pid}"]`)
  if (!b) return null
  return Math.hypot(parseFloat(b.style.left) - 176, parseFloat(b.style.top) - 176)
}, id)
const NEAR = (d, r) => d !== null && Math.abs(d - r) < 25
const RADII = { close: 48, friend: 84, acquaintance: 118, intending: 148 }
const nearest = (d) => Object.entries(RADII).sort((a, b) => Math.abs(a[1] - d) - Math.abs(b[1] - d))[0][0]
try {
  await page.goto(URL)
  await page.locator('.rings-wrap').waitFor()
  check('Web rings: five circles', (await page.locator('.rings-wrap circle').count()) === 5)
  check('Web rings: no spoke for unconnected people when crowded', (await page.locator('.rings-wrap path').count()) < 5)
  const manuelWeb = nearest(await radius(MANUEL))
  await page.getByRole('button', { name: 'Web Curator' }).click()
  const cur = page.locator('.sheet[data-kind=curator] .curator')
  await cur.getByRole('searchbox').waitFor({ timeout: 15_000 })
  check('Settings is ⋮ at the top right next to Timeline, bottom tabs People/Pipeline', (await cur.locator('.gear').count()) === 1 && (await cur.locator('.tabbar .tab').allInnerTexts()).join() === 'People,Pipeline')
  const gear = await cur.locator('.gear').boundingBox()
  const home = await page.locator('[data-sheet-home]').boundingBox()
  console.log('gear', JSON.stringify(gear), 'home', JSON.stringify(home))
  check('gear sits next to the ×, same row', Math.abs(gear.y + gear.height / 2 - (home.y + home.height / 2)) < 20 && gear.x + gear.width <= home.x + 4)
  await page.screenshot({ path: path.join(tmpdir(), 'one-ring-curator.png') })
  const heads = await cur.locator('h3.ring-heading').allInnerTexts()
  console.log('headings:', heads.join(' | '))
  const want = ['close friend', 'friend', 'acquaintance', 'intending to connect']
  const idx = want.map((w) => heads.findIndex((h) => h.toLowerCase().startsWith(w + ' (')))
  check('list order: close friend, friend, acquaintance, intending to connect', idx.every((i) => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]))
  const manuelRow = cur.locator('.person-row:has-text("Manuel Spornberger")')
  const section = await manuelRow.first().evaluate((r) => r.closest('.zone')?.previousElementSibling?.textContent ?? '')
  console.log('Manuel: Curator section', JSON.stringify(section.trim()), 'Web ring', manuelWeb)
  check('Manuel Spornberger: same ring in the Curator list and on the Web rings', section.toLowerCase().startsWith(manuelWeb === 'close' ? 'close friend' : manuelWeb))

  await cur.locator('[data-action="toggle-filters"]').click()
  await cur.locator('[data-filter="deceased"]').uncheck()
  await cur.locator('[data-filter="famous"]').uncheck()
  await cur.getByRole('searchbox').fill('Ramakrishna')
  await cur.locator('.person-row:has-text("Ramakrishna")').first().locator('.pr-open').click()
  await cur.locator('[data-action="ring-label"]').click()
  await cur.locator('[data-choice="friend"]').click()
  check('Curator shows Friend at once', /Friend/.test(await cur.locator('[data-action="ring-label"]').innerText()))
  await page.locator('[data-sheet-home]').click()
  await page.waitForTimeout(400)
  const d = await radius(PID)
  console.log('Ramakrishna on Web at', d, nearest(d))
  check('Web rings: Ramakrishna moved to the friend ring (no reload)', nearest(d) === 'friend' && NEAR(d, RADII.friend))
  const stored = await page.evaluate(() => ({ tw: JSON.parse(localStorage.getItem('trustweb.v1.me') ?? '{}'), crm: JSON.parse(localStorage.getItem('trustweb-crm.v1.me') ?? '{}') }))
  check('trustweb.v1.me holds ring friend', stored.tw.people?.find((p) => p.id === PID)?.ring === 'friend')
  check("Curator's own key holds no ring", Object.values(stored.crm.personFields ?? {}).every((f) => !('tw-ring' in f)))
  let after = ''
  for (let i = 0; i < 24; i++) { after = await tool('read_node', { nodeId: NODE }); if (ringLine(after) === 'friend' && approved(after)) break; await page.waitForTimeout(500) }
  console.log('Tana after:', ringLine(after), approved(after) ? '[X]' : '[ ]')
  check('Tana read-back: ring in TrustWeb = friend, ring approved [X]', ringLine(after) === 'friend' && approved(after))
  check('no page errors', errors.length === 0)
} finally {
  const was = ringLine(before)
  if (was) await tool('set_field_option', { nodeId: NODE, attributeId: 'rVfw62lb7BYD', optionId: OPT[was] ?? OPT.unsorted })
  else await tool('set_field_content', { nodeId: NODE, attributeId: 'rVfw62lb7BYD', content: null, mode: 'replace' })
  await tool('set_field_content', { nodeId: NODE, attributeId: '_7wgarGd90ZR', content: approved(before) ? '[X]' : '[ ]', mode: 'replace' })
  const reset = await tool('read_node', { nodeId: NODE })
  console.log('Tana reset:', ringLine(reset), approved(reset) ? '[X]' : '[ ]')
  await ctx.close()
}
process.exit(failed ? 1 : 0)
