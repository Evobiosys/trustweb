// Two-way sync between the TrustWeb record (the dev seed, later the phone's record through the Curator) and a notes vault.
//   node scripts/notes_sync.mjs pull --vault <dir> --seed <record.json> --reader claude:<model>|ollama:<model> [--include a,b] [--me "<name>"]
//     reads the notes that changed since the last pull (notes_read_persons.mjs is resumable by mtime), merges them into the seed
//     (notes_persons_to_record.mjs, one shot, idempotent), rewrites the tana-links file. TrustWeb's own pages folder is never read.
// `push` (record -> pages) and `serve` (loopback bridge for the Curator) follow once the direction's rules are settled (2026-10-16).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

function args(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
    else o._.push(a)
  }
  return o
}

function run(script, list) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...list], { stdio: 'inherit' })
  if (r.status !== 0) { console.error(`${script} failed (${r.status})`); process.exit(r.status ?? 1) }
}

export function pullArgs(o) {
  const work = o.work ?? path.join(o.vault, 'assets', 'local-notes')
  const readings = path.join(work, `people-${String(o.reader).replace(/[^a-z0-9.]+/gi, '-')}.jsonl`)
  const read = [o.vault, readings, '--reader', o.reader, ...(o.include ? ['--include', o.include] : []), ...(o.concurrency ? ['--concurrency', o.concurrency] : [])]
  const convert = [readings, o.seed, '--merge', o.seed, '--tana-links', path.join(work, 'tana-links.md'), ...(o.me ? ['--me', o.me] : []), ...(o['min-confidence'] ? ['--min-confidence', o['min-confidence']] : [])]
  return { work, readings, read, convert }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2))
  const cmd = o._[0]
  if (cmd !== 'pull' || !o.vault || !o.seed || !o.reader) {
    console.error('usage: notes_sync.mjs pull --vault <dir> --seed <record.json> --reader claude:<model>|ollama:<model> [--include a,b] [--me "<name>"] [--work <dir>]')
    process.exit(2)
  }
  if (!existsSync(o.seed)) { console.error(`no seed at ${o.seed}`); process.exit(2) }
  const { work, read, convert } = pullArgs(o)
  mkdirSync(work, { recursive: true })
  run('notes_read_persons.mjs', read)
  run('notes_persons_to_record.mjs', convert)
}
