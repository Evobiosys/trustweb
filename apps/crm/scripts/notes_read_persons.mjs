// Local notes (an Obsidian/Logseq vault of markdown files) -> people mentioned in them, one JSON line per note.
// The reading is done by a model behind ONE prompt so any user can repeat it: the Claude CLI (their own subscription) or a
// local Ollama model (free, slow, offline). File-only apart from the model call; the vault never leaves the machine with Ollama.
//   node scripts/notes_read_persons.mjs <vault> <out.jsonl> --reader claude:claude-haiku-5-5 | ollama:qwen3.5:9b
//        [--include memory,CONNECT,pages,journals] [--limit N] [--concurrency N] [--files list.txt] [--dry-run]
// Resumable: a note already in out.jsonl for the same reader and mtime is skipped. Failures go to <out>.errors.jsonl and are retried next run.
// Output line: { path, date: 'YYYY-MM-DD', reader, chars, people: [{ name, aliases, context, facts, met, confidence }] }
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MARK_FOLDER, noteCommunities, noteOptOut } from './notes_page.mjs'

export const PROMPT = `You extract people from one markdown note written by its owner ("the writer"). Output ONLY a JSON object, no prose:
{"people":[{"name":"<full name as written>","aliases":["<other spellings or short forms in the note>"],"context":"<how the writer knows them, one sentence, or empty>","facts":["<one short fact per item about THIS person only, close to the note's wording>"],"met":"<YYYY-MM-DD only if the note says when the writer first met them, else empty>","confidence":<0..1>}]}
Rules: only real individual humans the writer knows, met, or plans to meet. Not the writer, not authors of books or papers, not public figures merely mentioned, not companies, teams, products, places or AI assistants. A [[wikilink]] or @mention around a name is a strong signal; a bare first name in a to-do is weak (confidence below 0.5). Keep facts short and specific. If no people: {"people":[]}.`

const SKIP_DIRS = new Set(['node_modules', '.obsidian', '.git', 'reference', 'worktrees', '.rollback-repo', 'rollbacks', 'bak', 'code', 'Code', 'dist', '.trash', '.remember'])
const MAX_CHARS = 14000
const MIN_CHARS = 40

/** Every .md under the vault (or under --include subfolders), skipping code and caches; paths relative to the vault with "/". */
export function listNotes(vault, include = []) {
  const out = []
  const walk = (dir) => {
    if (existsSync(path.join(dir, MARK_FOLDER))) return   // TrustWeb's own pages (notes_page.mjs): never read back as notes
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue }
      if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(vault, path.join(dir, e.name)).split(path.sep).join('/'))
    }
  }
  const roots = include.length ? include.map((d) => path.join(vault, d)).filter(existsSync) : [vault]
  for (const r of roots) walk(r)
  return out.sort()
}

/** The note's own date: a journal file name (2026_07_11 or 2026-07-11), else front matter date:, else the file's mtime. */
export function noteDate(rel, text, mtimeMs) {
  const m = /(\d{4})[-_](\d{2})[-_](\d{2})/.exec(path.basename(rel))
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  const d = fm && /^(?:date|created)\s*:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(fm[1])
  if (d) return d[1]
  return new Date(mtimeMs).toISOString().slice(0, 10)
}

/** Long notes are read in pieces split at headings or blank lines; each piece stays under MAX_CHARS. */
export function chunks(text) {
  if (text.length <= MAX_CHARS) return [text]
  const out = []
  let cur = ''
  for (const block of text.split(/\n(?=#)|\n\n/)) {
    if (cur && cur.length + block.length + 2 > MAX_CHARS) { out.push(cur); cur = '' }
    cur = cur ? `${cur}\n\n${block}` : block
    while (cur.length > MAX_CHARS) { out.push(cur.slice(0, MAX_CHARS)); cur = cur.slice(MAX_CHARS) }
  }
  if (cur) out.push(cur)
  return out
}

/** The model's text -> { people }. Fences, leading prose and trailing junk are tolerated; anything else is an error. */
export function parseAnswer(raw) {
  const s = String(raw ?? '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON object in answer: ${s.slice(0, 120)}`)
  const d = JSON.parse(s.slice(start, end + 1))
  if (!Array.isArray(d.people)) throw new Error('answer has no people[]')
  return {
    people: d.people
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => ({
        name: p.name.trim().slice(0, 120),
        aliases: (Array.isArray(p.aliases) ? p.aliases : []).map((a) => String(a).trim()).filter(Boolean).slice(0, 8),
        context: String(p.context ?? '').trim().slice(0, 300),
        facts: (Array.isArray(p.facts) ? p.facts : []).map((f) => String(f).trim()).filter(Boolean).slice(0, 40),
        met: /^\d{4}-\d{2}-\d{2}$/.test(String(p.met ?? '')) ? p.met : '',
        confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      })),
  }
}

/** Two readings of the same note (or two chunks): one list, names merged case-insensitively, facts appended. */
export function mergePeople(lists) {
  const by = new Map()
  for (const list of lists) for (const p of list) {
    const k = p.name.toLowerCase()
    const prev = by.get(k)
    if (!prev) { by.set(k, { ...p, aliases: [...p.aliases], facts: [...p.facts] }); continue }
    for (const a of p.aliases) if (!prev.aliases.includes(a)) prev.aliases.push(a)
    for (const f of p.facts) if (!prev.facts.includes(f)) prev.facts.push(f)
    if (!prev.context) prev.context = p.context
    if (!prev.met) prev.met = p.met
    prev.confidence = Math.max(prev.confidence, p.confidence)
  }
  return [...by.values()]
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 300)}`))))
    p.stdin.end(input)
  })
}

/** A reader = a function (prompt text) -> model answer text. "claude:<model>" uses the Claude CLI; "ollama:<model>" the local server. */
export function readerFor(spec) {
  const [kind, ...rest] = spec.split(':')
  const model = rest.join(':')
  if (kind === 'claude') {
    return async (text) => {
      const out = await run('claude', ['-p', '--model', model, '--output-format', 'json'], text)
      const d = JSON.parse(out)
      if (d.is_error) throw new Error(`claude: ${String(d.result).slice(0, 200)}`)
      return { text: d.result, cost: d.total_cost_usd ?? 0 }
    }
  }
  if (kind === 'ollama') {
    const url = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
    return async (text) => {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0, num_ctx: 16384 }, messages: [{ role: 'user', content: text }] }),
      })
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const d = await res.json()
      return { text: d.message?.content ?? '', cost: 0 }
    }
  }
  throw new Error(`unknown reader "${spec}" (claude:<model> or ollama:<model>)`)
}

export const noteKey = (rel, mtimeMs, reader) => createHash('sha1').update(`${rel}\n${Math.round(mtimeMs)}\n${reader}`).digest('hex').slice(0, 16)

/** One note through the reader: every chunk, merged. */
export async function readNote(reader, rel, text, date) {
  const results = []
  let cost = 0
  for (const c of chunks(text)) {
    const r = await reader(`${PROMPT}\n\nNOTE (file ${rel}, dated ${date}):\n${c}`)
    cost += r.cost
    results.push(parseAnswer(r.text).people)
  }
  return { people: mergePeople(results), cost }
}

function parseArgs(argv) {
  const o = { positional: [], include: [], limit: Infinity, concurrency: 2, files: null, dryRun: false, reader: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reader') o.reader = argv[++i]
    else if (a === '--include') o.include = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--limit') o.limit = Number(argv[++i])
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(argv[++i]) || 1)
    else if (a === '--files') o.files = argv[++i]
    else if (a === '--dry-run') o.dryRun = true
    else o.positional.push(a)
  }
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const [vault, outPath] = o.positional
  if (!vault || !outPath || (!o.reader && !o.dryRun)) {
    console.error('usage: notes_read_persons.mjs <vault> <out.jsonl> --reader claude:<model>|ollama:<model> [--include a,b] [--limit N] [--concurrency N] [--files list.txt] [--dry-run]')
    process.exit(2)
  }
  const errPath = `${outPath}.errors.jsonl`
  const done = new Set(existsSync(outPath) ? readFileSync(outPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : [])
  let rels = o.files ? readFileSync(o.files, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : listNotes(vault, o.include)
  const todo = []
  let skippedSmall = 0
  let optedOut = 0
  for (const rel of rels) {
    const abs = path.join(vault, rel)
    const st = statSync(abs)
    const text = readFileSync(abs, 'utf8')
    if (text.trim().length < MIN_CHARS) { skippedSmall++; continue }
    if (noteOptOut(text)) { optedOut++; continue }
    const key = noteKey(rel, st.mtimeMs, o.reader)
    if (done.has(key)) continue
    todo.push({ rel, text, key, date: noteDate(rel, text, st.mtimeMs), communities: noteCommunities(text) })
    if (todo.length >= o.limit) break
  }
  console.log(`${rels.length} notes, ${skippedSmall} too small, ${optedOut} opted out (#no-trustweb), ${done.size} already read, ${todo.length} to read with ${o.reader || '(dry run)'}`)
  if (o.dryRun) { for (const t of todo) console.log(`${t.date}  ${t.rel}  (${t.text.length} chars)`); return }
  const reader = readerFor(o.reader)
  let i = 0
  let cost = 0
  let okN = 0
  let errN = 0
  const t0 = Date.now()
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++]
      try {
        const r = await readNote(reader, t.rel, t.text, t.date)
        cost += r.cost
        appendFileSync(outPath, `${JSON.stringify({ key: t.key, path: t.rel, date: t.date, reader: o.reader, chars: t.text.length, ...(t.communities.length ? { communities: t.communities } : {}), people: r.people })}\n`)
        okN++
        console.log(`${okN + errN}/${todo.length} ${t.rel}: ${r.people.length} people${r.cost ? ` ($${r.cost.toFixed(4)})` : ''}`)
      } catch (e) {
        errN++
        appendFileSync(errPath, `${JSON.stringify({ key: t.key, path: t.rel, error: String(e.message ?? e).slice(0, 500), at: new Date().toISOString() })}\n`)
        console.log(`${okN + errN}/${todo.length} ${t.rel}: ERROR ${String(e.message ?? e).slice(0, 120)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: o.concurrency }, worker))
  console.log(`read ${okN}, failed ${errN}, ${((Date.now() - t0) / 1000).toFixed(0)} s${cost ? `, $${cost.toFixed(2)}` : ''} -> ${outPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
