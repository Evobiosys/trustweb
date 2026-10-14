// The desire to connect per #person node ("intending to connect (0-10)" and "intending since"): the cached nodes file predates the fields, so the converter reads this too.
// Talks to the local Tana API only (loopback), read-only. Result: { "<person node id>": { "n": 0-10, "since": "YYYY-MM-DD" }, ... }
//   node scripts/tana_intending.mjs <out.json> [token-file]
import { readFileSync, writeFileSync } from 'node:fs'

const PERSON = 'Kd2-lusfBo'
const DESIRE = 'UAfC4PcYo2po'
const WORKSPACE = '34saXxFYBC'

const [outPath, tokenFile = `${process.env.HOME}/.pi/tana-token`] = process.argv.slice(2)
if (!outPath) { console.error('usage: tana_intending.mjs <out.json> [token-file]'); process.exit(2) }
const token = readFileSync(tokenFile, 'utf8').trim()
let sid = ''
let n = 0
async function rpc(method, params, notify = false) {
  const r = await fetch('http://127.0.0.1:8262/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }),
  })
  if (!r.ok) throw new Error(`Tana API HTTP ${r.status}`)
  sid = r.headers.get('mcp-session-id') ?? sid
  const text = (await r.text()).trim()
  return text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).pop()?.slice(5) ?? '{}')
}
const tool = async (name, args) => {
  const { result, error } = await rpc('tools/call', { name, arguments: args })
  if (error || result?.isError) throw new Error(error?.message ?? result.content?.[0]?.text)
  return result.content.map((c) => c.text).join('')
}

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tana-intending', version: '1' } })
await rpc('notifications/initialized', {}, true)

const day = (offset) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** Tana prints relative days ("Today") for date fields. */
const dateOf = (raw) => /\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? (/today/i.test(raw) ? day(0) : /yesterday/i.test(raw) ? day(-1) : /tomorrow/i.test(raw) ? day(1) : undefined)

const query = { and: [{ hasType: PERSON }, { field: { fieldId: DESIRE, state: 'set' } }] }
const candidates = JSON.parse(await tool('search_nodes', { query, workspaceIds: [WORKSPACE], limit: 500 }))
const out = {}
for (const c of candidates) {
  if (c.inTrash === true) continue
  const outline = await tool('read_node', { nodeId: c.id, maxDepth: 1 })
  const n = Number(/\*\*intending to connect \(0-10\)\*\*:\s*(\d+)/.exec(outline)?.[1])
  if (!Number.isFinite(n)) continue
  const since = dateOf(/\*\*intending since\*\*:\s*(.*?)(?: <!--|$)/m.exec(outline)?.[1] ?? '')
  out[c.id] = { n, ...(since ? { since } : {}) }
}
writeFileSync(outPath, JSON.stringify(out))
console.log(`intending in Tana: ${Object.keys(out).length} (of ${candidates.length} with the field set)`)
