// Ids of the #person nodes whose "hide in trustweb" checkbox is ticked in Tana: the cached nodes file predates the field, so the converter reads this list too.
// Talks to the local Tana API only (loopback), read-only. Result: ["<person node id>", ...]
//   node scripts/tana_hidden.mjs <out.json> [token-file]
import { readFileSync, writeFileSync } from 'node:fs'

const PERSON = 'Kd2-lusfBo'
const HIDE = '4J9bhDw1UdTj'
const WORKSPACE = '34saXxFYBC'

const [outPath, tokenFile = `${process.env.HOME}/.pi/tana-token`] = process.argv.slice(2)
if (!outPath) { console.error('usage: tana_hidden.mjs <out.json> [token-file]'); process.exit(2) }
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

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tana-hidden', version: '1' } })
await rpc('notifications/initialized', {}, true)
const query = { and: [{ hasType: PERSON }, { field: { fieldId: HIDE, state: 'set' } }] }
const candidates = JSON.parse(await tool('search_nodes', { query, workspaceIds: [WORKSPACE], limit: 500 }))
const ids = []
for (const c of candidates) if (c.inTrash !== true && /\*\*hide in trustweb\*\*:\s*\[[xX]\]/.test(await tool('read_node', { nodeId: c.id, maxDepth: 1 }))) ids.push(c.id)
writeFileSync(outPath, JSON.stringify(ids))
console.log(`hidden in Tana: ${ids.length} (of ${candidates.length} with the field set)`)
