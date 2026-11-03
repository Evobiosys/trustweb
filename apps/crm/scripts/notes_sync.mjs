// Two-way sync between the TrustWeb record (the dev seed, later the phone's record through the Curator) and a notes vault.
//   node scripts/notes_sync.mjs pull --vault <dir> --seed <record.json> --reader claude:<model>|ollama:<model> [--include a,b]
//        [--skip-folders a,b] [--me "<name>"] [--work <dir>] [--no-lock]
//     reads the notes that changed since the last pull (notes_read_persons.mjs is resumable by content hash), merges them into the
//     seed (notes_persons_to_record.mjs, one shot, idempotent), rewrites the tana-links file. TrustWeb's own pages folder is never read.
//     --skip-folders goes to the reader (plus the vault's .trustweb-notes.json). Safe on a schedule: the run holds <work>/pull.lock
//     (notes_lock.mjs; stale once its pid died or after 6 h); a second run meanwhile exits 3 and changes nothing. A run with no
//     new notes reads nothing and merges to the same record. Exit: 0 done, 2 usage / no seed / broken .trustweb-notes.json,
//     3 another pull holds the lock, else the failing step's code. Scheduling (launchd, cron, systemd): docs/curator-notes-sync.md.
//   node scripts/notes_sync.mjs cleanup --vault <dir> --record <record.json> [--archive <dir>] [--dry-run]
//     runs notes_cleanup.mjs: TrustWeb blocks of people no longer in the record are archived, then cut from the notes.
// `push` (record -> pages) and `serve` (loopback bridge for the Curator) follow once the direction's rules are settled (2026-10-16).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { acquireLock, releaseOnExit } from './notes_lock.mjs'

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
  const read = [o.vault, readings, '--reader', o.reader, ...(o.include ? ['--include', o.include] : []), ...(o['skip-folders'] ? ['--skip-folders', o['skip-folders']] : []), ...(o.concurrency ? ['--concurrency', o.concurrency] : [])]
  const convert = [readings, o.seed, '--merge', o.seed, '--tana-links', path.join(work, 'tana-links.md'),
    '--decisions', path.join(work, 'join-decisions.jsonl'), '--offers', path.join(work, 'join-offers.json'), ...(o.me ? ['--me', o.me] : []), ...(o['min-confidence'] ? ['--min-confidence', o['min-confidence']] : [])]
  return { work, readings, lockPath: path.join(work, 'pull.lock'), read, convert }
}

/** cleanup: the arguments notes_cleanup.mjs gets (blocks of people gone from the record, archived then cut). */
export const cleanupArgs = (o) => ['--vault', o.vault, '--record', o.record, ...(typeof o.archive === 'string' ? ['--archive', o.archive] : []), ...(o['dry-run'] === true ? ['--dry-run'] : [])]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2))
  const cmd = o._[0]
  if (cmd === 'cleanup' && typeof o.vault === 'string' && typeof o.record === 'string') { run('notes_cleanup.mjs', cleanupArgs(o)); process.exit(0) }
  if (cmd !== 'pull' || !o.vault || !o.seed || !o.reader) {
    console.error('usage: notes_sync.mjs pull --vault <dir> --seed <record.json> --reader claude:<model>|ollama:<model> [--include a,b] [--skip-folders a,b] [--me "<name>"] [--work <dir>] [--no-lock] | cleanup --vault <dir> --record <record.json> [--archive <dir>] [--dry-run]')
    process.exit(2)
  }
  if (!existsSync(o.seed)) { console.error(`no seed at ${o.seed}`); process.exit(2) }
  const { work, readings, lockPath, read, convert } = pullArgs(o)
  mkdirSync(work, { recursive: true })
  if (!o['no-lock']) {
    const lock = acquireLock(lockPath)
    if (!lock.ok) { console.error(`another pull is running (pid ${lock.held.pid}, since ${lock.held.startedAt})`); process.exit(3) }
    releaseOnExit(lock)
  }
  run('notes_read_persons.mjs', read)
  if (!existsSync(readings)) { console.log('no readings yet (nothing read, or every read failed): the seed is unchanged'); process.exit(0) }
  run('notes_persons_to_record.mjs', convert)
}
