// First-met date per #person from Tana's day breadcrumbs: the earliest day any node mentioning the person's name sits under.
// Talks to the local Tana API only (loopback), read-only. Result: { <person node id>: { metAt: ms, context?: string } }, read by tana_persons_to_record.mjs.
//   node scripts/tana_first_met.mjs <persons-index.json> <out.json> [token-file]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKSPACE = '34saXxFYBC'
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+([a-z]{3})[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*$/i
// Told by Jakob, wins over what the search finds.
const OVERRIDES = { 'Katherine Colquitt': { metAt: Date.UTC(2025, 6, 1), context: 'Gathering, Czechia' } }

/** The day a breadcrumb sits under, as ms (UTC midnight), or null. Year: in the day crumb, else a "2025" crumb before it, else the node's created year. */
export function dayOf(breadcrumb, created) {
  const i = breadcrumb.findIndex((c) => DAY.test(c))
  if (i < 0) return null
  const [, mon, d, y] = DAY.exec(breadcrumb[i])
  const year = Number(y) || Number(breadcrumb.slice(0, i).reverse().find((c) => /^\d{4}$/.test(c))) || new Date(created).getUTCFullYear()
  const month = MONTHS.indexOf(mon.toLowerCase())
  return month < 0 || !year ? null : Date.UTC(year, month, Number(d))
}

/** Earliest dated hit of one search: { metAt, context } where context is the last crumb under the day. */
export function earliest(hits) {
  let best = null
  for (const h of hits) {
    if (h.inTrash) continue
    const metAt = dayOf(h.breadcrumb ?? [], h.created)
    if (metAt === null || (best && metAt >= best.metAt)) continue
    const under = h.breadcrumb.slice(h.breadcrumb.findIndex((c) => DAY.test(c)) + 1).filter((c) => !/^week \d+$/i.test(c))
    best = { metAt, ...(under.length ? { context: under[under.length - 1].trim() } : {}) }
  }
  return best
}

async function connect(token) {
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tana-first-met', version: '1' } })
  await rpc('notifications/initialized', {}, true)
  return async (name) => {
    const { result, error } = await rpc('tools/call', { name: 'search_nodes', arguments: { query: { textContains: name }, workspaceIds: [WORKSPACE], limit: 50 } })
    if (error || result?.isError) throw new Error(error?.message ?? result.content?.[0]?.text)
    return JSON.parse(result.content.map((c) => c.text).join(''))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [indexPath, outPath, tokenFile = `${process.env.HOME}/.pi/tana-token`] = process.argv.slice(2)
  if (!outPath) { console.error('usage: tana_first_met.mjs <persons-index.json> <out.json> [token-file]'); process.exit(2) }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const search = await connect(readFileSync(tokenFile, 'utf8').trim())
  const byName = new Map()
  for (const p of index) if (p.name.trim().length >= 3 && !p.name.includes('@')) byName.set(p.name.trim(), [...(byName.get(p.name.trim()) ?? []), p.id])
  const out = {}
  for (const [name, ids] of byName) {
    const found = OVERRIDES[name] ?? earliest(await search(name))
    if (found) for (const id of ids) out[id] = found
  }
  writeFileSync(outPath, JSON.stringify(out))
  console.log(`names ${byName.size}, persons with a first-met date ${Object.keys(out).length} of ${index.length}`)
}
