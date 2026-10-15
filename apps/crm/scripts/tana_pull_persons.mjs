// Tana -> persons-nodes.json, then the record: the pull direction the CRM lacked (it only pushes field edits).
// Local Tana API only (loopback, read-only). Never logs content, only counts and ids on stderr.
//   TW_CRM_TANA_TOKEN=<token> node scripts/tana_pull_persons.mjs <persons-index.json> <persons-nodes.json>
//     [--only <nodeId,...>] [--since <ISO>] [--out <record.json>] [--no-convert] [--list-tools]
// --since keeps index entries whose `edited` (else `created`) is at or after it. connect() mirrors src/tana_sync.ts (a .mjs cannot import the .ts).
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const TANA_URL = 'http://127.0.0.1:8262/mcp'
const PAUSE_MS = 50
const SAVE_EVERY = 25
const STALE_MS = 6 * 3_600_000

function parseRpc(body) {
  const text = body.trim()
  if (text.startsWith('{')) return JSON.parse(text)
  return JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).pop()?.slice(5) ?? '{}')
}

/** Opens a session; returns { call(name, args) -> text, rpc }. */
export async function connect(token, fetcher = fetch) {
  let session = ''
  let n = 0
  async function rpc(method, params, notify = false) {
    const r = await fetcher(TANA_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }),
    })
    if (!r.ok) throw new Error(`Tana API answered HTTP ${r.status}`)
    session = r.headers.get('mcp-session-id') ?? session
    const reply = parseRpc(await r.text())
    if (reply.error) throw new Error(reply.error.message ?? 'Tana API error')
    return reply
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'trustweb-crm-pull', version: '0.1.0' } })
  await rpc('notifications/initialized', {}, true)
  const call = async (name, args) => {
    const { result } = await rpc('tools/call', { name, arguments: args })
    const text = (result?.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result?.isError) throw new Error(text || `${name} failed`)
    return text
  }
  return { call, rpc }
}

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14)

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

function backup(file) {
  if (existsSync(file)) copyFileSync(file, `${file}.bak.${stamp()}`)
}

/** Reads the chosen index nodes into nodesPath (resumable); returns counts. Throws when the API itself is unreachable. */
export async function pull({ indexPath, nodesPath, call, only, since, pause = PAUSE_MS, log = () => {} }) {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const old = existsSync(nodesPath) ? JSON.parse(readFileSync(nodesPath, 'utf8')) : {}
  const ids = index
    .filter((p) => !only || only.includes(p.id))
    .filter((p) => !since || (p.edited ?? p.created ?? '') >= since)
    .map((p) => p.id)
  const progressPath = `${nodesPath}.pull-progress.json`
  let fresh = {}
  if (existsSync(progressPath)) {
    const saved = JSON.parse(readFileSync(progressPath, 'utf8'))
    if (Date.now() - saved.at < STALE_MS) fresh = saved.nodes
  }
  const resumed = ids.filter((id) => id in fresh).length
  const save = () => writeAtomic(progressPath, JSON.stringify({ at: Date.now(), nodes: fresh }))
  const failed = []
  let sinceSave = 0
  for (const id of ids) {
    if (id in fresh) continue
    try {
      fresh[id] = await call('read_node', { nodeId: id, maxDepth: 1 })
    } catch {
      failed.push(id)
    }
    if (++sinceSave % SAVE_EVERY === 0) save()
    if (pause) await new Promise((r) => setTimeout(r, pause))
  }
  if (sinceSave) save()
  backup(nodesPath)
  writeAtomic(nodesPath, JSON.stringify({ ...old, ...fresh }))
  rmSync(progressPath, { force: true })
  log(`pulled ${Object.keys(fresh).length - resumed}, resumed ${resumed}, unreadable ${failed.length}${failed.length ? ` (${failed.join(',')})` : ''}`)
  return { pulled: Object.keys(fresh).length - resumed, resumed, failed }
}

function parseArgs(argv) {
  const flag = (name) => argv.includes(name)
  const value = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--only', '--since', '--out'].includes(argv[i - 1]))
  return { positional, only: value('--only')?.split(',').filter(Boolean), since: value('--since'), out: value('--out'), noConvert: flag('--no-convert'), listTools: flag('--list-tools') }
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const [indexPath, nodesPath] = a.positional
  const token = process.env.TW_CRM_TANA_TOKEN
  if (!indexPath || !nodesPath || !token) {
    console.error('usage: TW_CRM_TANA_TOKEN=... tana_pull_persons.mjs <persons-index.json> <persons-nodes.json> [--only id,...] [--since ISO] [--out record.json] [--no-convert] [--list-tools]')
    process.exit(2)
  }
  const log = (m) => console.error(m)
  const { call, rpc } = await connect(token)
  if (a.listTools) log(`tools: ${((await rpc('tools/list', {})).result?.tools ?? []).map((t) => t.name).join(', ')}`)
  await pull({ indexPath, nodesPath, call, only: a.only, since: a.since, log })
  if (a.noConvert) return
  const out = a.out ?? path.join(path.dirname(nodesPath), 'trustweb-record.json')
  backup(out)
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./tana_persons_to_record.mjs', import.meta.url)), indexPath, nodesPath, out], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) process.exit(r.status ?? 1)
  log(`record written: ${out}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
