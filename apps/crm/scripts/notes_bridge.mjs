// The notes bridge (Jakob 2026-10-16): the one thing on this computer that may write TrustWeb into the vault. Loopback only,
// token-gated, user-level LaunchAgent (never a system daemon). Access as tight as it gets: it reads one config file, touches
// .md files inside ONE vault folder, and answers only browsers on 127.0.0.1/localhost that carry the token.
//   node scripts/notes_bridge.mjs init --vault <dir> [--port 8263]        writes ~/.config/trustweb/notes-bridge.json (0600) with a fresh token, prints it
//   node scripts/notes_bridge.mjs serve                                   the bridge the Curator talks to (Settings > Obsidian / Logseq)
//   node scripts/notes_bridge.mjs push --record <record.json> [--everyone] the same write as a CLI (cron, other users): blocks into home notes;
//                                                                         --everyone also one page per person under <vault>/TrustWeb/People (one shot)
//   node scripts/notes_bridge.mjs changes --record <record.json>          what the vault says that the record does not (ring edits, added bullets)
// HTTP (all need `Authorization: Bearer <token>`): GET /status, POST /push {people, everyone?}, POST /changes {people}
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MARK_FOLDER, blockChanges, parseBlocks, slug, updatePage, upsertBlock } from './notes_page.mjs'

const CONFIG = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'trustweb', 'notes-bridge.json')
const PAGES_DIR = path.join('TrustWeb', 'People')
const SKIP_DIRS = new Set(['node_modules', '.obsidian', '.git', 'reference', 'worktrees', '.rollback-repo', 'rollbacks', 'bak', 'code', 'Code', 'dist', '.trash'])
const MAX_BODY = 8 * 1024 * 1024

export function readConfig(file = CONFIG) {
  if (!existsSync(file)) throw new Error(`no config at ${file}: run notes_bridge.mjs init --vault <dir>`)
  const c = JSON.parse(readFileSync(file, 'utf8'))
  if (!c.vault || !c.token) throw new Error(`${file}: vault and token needed`)
  return { port: 8263, ...c }
}

export function writeConfig(c, file = CONFIG) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Every note in the vault (vault-relative, "/"), skipping code and TrustWeb's own pages. */
export function listNotes(vault) {
  const out = []
  const walk = (dir) => {
    if (existsSync(path.join(dir, MARK_FOLDER))) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue }
      if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(vault, path.join(dir, e.name)).split(path.sep).join('/'))
    }
  }
  walk(vault)
  return out.sort()
}

/**
 * Where each person lives in the vault: the earliest-dated note the reader found them in (assets/local-notes/people-*.jsonl),
 * else the earliest note a local line of theirs points at. Name match is case-insensitive on name and aliases.
 */
export function homeNotes(people, readings) {
  const byName = new Map()
  for (const r of readings) for (const m of r.people) for (const n of [m.name, ...(m.aliases ?? [])]) {
    const k = norm(n)
    const prev = byName.get(k)
    if (!prev || r.date < prev.date) byName.set(k, { path: r.path, date: r.date })
  }
  const home = new Map()
  for (const p of people) {
    const local = p.lines.filter((l) => l.source?.kind === 'local' && l.source.path).sort((a, b) => a.notedAt - b.notedAt)[0]
    const hit = byName.get(norm(p.name)) ?? (local ? { path: local.source.path } : null)
    if (hit) home.set(p.id, hit.path)
  }
  return home
}

export function loadReadings(vault) {
  const dir = path.join(vault, 'assets', 'local-notes')
  if (!existsSync(dir)) return []
  const by = new Map()
  for (const f of readdirSync(dir).filter((f) => /^people-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(dir, f), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); by.set(r.path, r) }
  }
  return [...by.values()]
}

/** A vault-relative .md path resolved inside the vault, or null (never a write outside it). */
export function safePath(vault, rel) {
  if (typeof rel !== 'string' || !rel.endsWith('.md')) return null
  const abs = path.resolve(vault, rel)
  const root = path.resolve(vault) + path.sep
  return abs.startsWith(root) ? abs : null
}

/** Blocks into home notes for the people that have one; with `everyone`, also one page per person under TrustWeb/People. */
export function push(vault, people, { everyone = false, now = Date.now(), own = new Map() } = {}) {
  const home = homeNotes(people, loadReadings(vault))
  const res = { written: 0, unchanged: 0, noHome: 0, pages: 0, errors: [] }
  const byFile = new Map()
  for (const p of people) {
    const rel = home.get(p.id)
    if (!rel) { res.noHome++; continue }
    ;(byFile.get(rel) ?? byFile.set(rel, []).get(rel)).push(p)
  }
  for (const [rel, list] of byFile) {
    const abs = safePath(vault, rel)
    if (!abs || !existsSync(abs)) { res.errors.push(`${rel}: not in the vault`); continue }
    const before = readFileSync(abs, 'utf8')
    let text = before
    for (const p of list) text = upsertBlock(text, p, { now })
    if (text === before) res.unchanged += list.length
    else { writeFileSync(abs, text); own.set(rel, statSync(abs).mtimeMs); res.written += list.length }
  }
  if (everyone) {
    const dir = path.join(vault, PAGES_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, MARK_FOLDER), '')
    for (const p of people) {
      const file = path.join(dir, slug(p))
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null
      const text = updatePage(before, p, { now })
      if (text !== before) { writeFileSync(file, text); res.pages++ }
    }
  }
  return res
}

/** What the vault says that the record does not: per person with a block, a ring edited after the block was written, and added bullets. */
export function changes(vault, people) {
  const byId = new Map(people.map((p) => [p.id, p]))
  const out = []
  for (const rel of listNotes(vault)) {
    const abs = path.join(vault, rel)
    const text = readFileSync(abs, 'utf8')
    if (!text.includes('<!-- trustweb:begin ')) continue
    const mtime = statSync(abs).mtimeMs
    for (const b of parseBlocks(text)) {
      const p = byId.get(b.id)
      if (!p) continue
      const c = blockChanges(b, p, mtime)
      if (c.ring || c.newLines.length) out.push({ id: b.id, path: rel, ...c })
    }
  }
  return out
}

// ---- HTTP ------------------------------------------------------------------------------------------------------------
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

export function allowed(req, cfg) {
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return 'host'
  const origin = req.headers.origin
  if (origin && !LOCAL_ORIGIN.test(origin)) return 'origin'
  if (req.method === 'OPTIONS') return null
  const auth = req.headers.authorization ?? ''
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!given || given.length !== cfg.token.length || createHash('sha256').update(given).digest('hex') !== createHash('sha256').update(cfg.token).digest('hex')) return 'token'
  return null
}

function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0
    const chunks = []
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const validPeople = (x) => Array.isArray(x) && x.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.lines))

/** The vault watched: `changedAt` moves when a .md file outside the skipped folders is saved by anyone but the bridge itself (own = the mtimes it wrote). */
export function watchVault(cfg) {
  const state = { changedAt: 0, own: new Map() }
  try {
    watch(cfg.vault, { recursive: true }, (_e, name) => {
      const rel = String(name ?? '').split(path.sep).join('/')
      if (!rel.endsWith('.md') || rel.split('/').some((d) => SKIP_DIRS.has(d))) return
      try { if (state.own.get(rel) === statSync(path.join(cfg.vault, rel)).mtimeMs) return } catch { /* deleted: counts as a change */ }
      state.changedAt = Date.now()
    })
  } catch (e) { console.error(`watch: ${e.message}`) }
  return state
}

export function handler(cfg, watched = { changedAt: 0, own: new Map() }) {
  return async (req, res) => {
    const origin = req.headers.origin
    const cors = origin && LOCAL_ORIGIN.test(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' } : {}
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(obj)) }
    const why = allowed(req, cfg)
    if (why) return send(why === 'token' ? 401 : 403, { error: why })
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/status') return send(200, { vault: path.basename(cfg.vault), changedAt: watched.changedAt })
      if (req.method === 'POST' && (url.pathname === '/push' || url.pathname === '/changes')) {
        const b = JSON.parse(await body(req) || '{}')
        if (!validPeople(b.people)) return send(400, { error: 'people[] needed' })
        if (url.pathname === '/push') return send(200, push(cfg.vault, b.people, { everyone: b.everyone === true, own: watched.own }))
        return send(200, { changes: changes(cfg.vault, b.people) })
      }
      send(404, { error: 'no such route' })
    } catch (e) {
      send(500, { error: String(e.message ?? e).slice(0, 200) })
    }
  }
}

export function serve(cfg, onListen = () => {}) {
  const server = createServer(handler(cfg, watchVault(cfg)))
  server.listen(cfg.port, '127.0.0.1', () => onListen(server))
  return server
}

function args(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i]
    else o._.push(a)
  }
  return o
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2))
  const cmd = o._[0]
  if (cmd === 'init') {
    if (!o.vault || !existsSync(o.vault)) { console.error('init --vault <existing dir> [--port 8263]'); process.exit(2) }
    const c = { vault: path.resolve(o.vault), port: Number(o.port) || 8263, token: randomBytes(24).toString('base64url') }
    writeConfig(c)
    console.log(`config ${CONFIG} (0600)\nvault ${c.vault}\nport ${c.port}\ntoken ${c.token}   <- paste into the Curator: Settings > Obsidian / Logseq`)
  } else if (cmd === 'serve') {
    const cfg = readConfig()
    serve(cfg, () => console.log(`notes bridge on http://127.0.0.1:${cfg.port}/ for ${cfg.vault}`))
  } else if (cmd === 'push' || cmd === 'changes') {
    const cfg = readConfig()
    if (!o.record) { console.error(`${cmd} --record <record.json>`); process.exit(2) }
    const people = JSON.parse(readFileSync(o.record, 'utf8')).people
    if (cmd === 'push') console.log(JSON.stringify(push(cfg.vault, people, { everyone: o.everyone === true })))
    else console.log(JSON.stringify(changes(cfg.vault, people), null, 1))
  } else {
    console.error('usage: notes_bridge.mjs init --vault <dir> | serve | push --record <record.json> [--everyone] | changes --record <record.json>')
    process.exit(2)
  }
}
