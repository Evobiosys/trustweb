// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Cleanup pass: the TrustWeb blocks of people who left the record come out of the vault notes; nothing is deleted silently.
//   node scripts/notes_cleanup.mjs --vault <dir> --record <record.json> | --people <people.json> [--archive <dir>] [--dry-run]
//     --record = a record with `people`; --people = a bare array (the bridge / Curator path). Prints a one-line summary (JSON);
//     --dry-run also one line per block that would go, and writes nothing. Exit 0; 2 on bad usage.
// Per removed block, in this order: the block verbatim into <archive>/<YYYY-MM-DD>/<note path, "/" -> "__">.<id>.md (header:
// note, person, archived stamp; a same-day repeat gets .2, .3: an archive is never overwritten), the archive folder marked
// (MARK_FOLDER: the notes reader and the walker never read it back), then the note rewritten (only when changed, only inside the
// vault), then one JSON line {at, path, id, archived} into assets/local-notes/cleanup.log.jsonl (auditable).
// A note that opts out (#no-trustweb) is cleaned too: a block in it is TrustWeb's own residue, not the person's text.
// An empty people list removes nothing (a missing or empty record must never strip the vault). Errors are collected, never thrown.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MARK_FOLDER, parseBlocks, removeBlocks } from './notes_page.mjs'
import { listNotes, safePath } from './notes_bridge.mjs'

const fileId = (id) => id.replace(/[\\/:*?"<>|\s]/g, '_')

/** `own` (the bridge's watcher map) gets the mtimes of every .md this pass writes inside the vault, so they never count as edits. */
export function cleanup(vault, people, { now = Date.now(), dryRun = false, archiveDir = path.join(vault, 'archive', 'trustweb-blocks'), logFile = path.join(vault, 'assets', 'local-notes', 'cleanup.log.jsonl'), own = new Map() } = {}) {
  const res = { scanned: 0, removed: [], unchanged: 0, errors: [] }
  if (!Array.isArray(people) || people.length === 0) { res.errors.push('no people: nothing removed (an empty record never strips the vault)'); return res }
  const keep = new Set(people.map((p) => p.id))
  const at = new Date(now).toISOString()
  const dayDir = path.join(archiveDir, at.slice(0, 10))
  const inVault = (abs) => { const r = path.relative(vault, abs); return r.startsWith('..') || path.isAbsolute(r) ? abs : r.split(path.sep).join('/') }
  let notes
  try { notes = listNotes(vault) } catch (e) { res.errors.push(`vault: ${e.message}`); return res }
  res.scanned = notes.length
  const taken = new Set()
  const archiveFile = (rel, id) => {
    const base = `${rel.split('/').join('__')}.${fileId(id)}`
    for (let n = 1; ; n++) {
      const f = path.join(dayDir, `${base}${n === 1 ? '' : `.${n}`}.md`)
      if (!taken.has(f) && !existsSync(f)) { taken.add(f); return f }
    }
  }
  for (const rel of notes) {
    const abs = safePath(vault, rel)
    if (!abs) { res.errors.push(`${rel}: not in the vault`); continue }
    let text
    try { text = readFileSync(abs, 'utf8') } catch (e) { res.errors.push(`${rel}: ${e.message}`); continue }
    if (!text.includes('<!-- trustweb:begin ')) continue
    const cut = removeBlocks(text, keep)
    if (!cut.removed.length) { res.unchanged++; continue }
    const done = []
    try {
      for (const r of cut.removed) {
        const name = parseBlocks(r.block)[0]?.name ?? ''
        const file = archiveFile(rel, r.id)
        done.push({ id: r.id, name, path: rel, archived: inVault(file) })
        if (dryRun) continue
        mkdirSync(dayDir, { recursive: true })
        if (!existsSync(path.join(archiveDir, MARK_FOLDER))) writeFileSync(path.join(archiveDir, MARK_FOLDER), '')
        writeFileSync(file, `# archived TrustWeb block\nnote: ${rel}\nperson: ${r.id}${name ? ` ${name}` : ''}\narchived: ${at}\n\n${r.block}`, { flag: 'wx' })
        const a = inVault(file)
        if (!path.isAbsolute(a)) own.set(a, statSync(file).mtimeMs)
      }
      if (!dryRun) {
        writeFileSync(abs, cut.text)
        own.set(rel, statSync(abs).mtimeMs)
        mkdirSync(path.dirname(logFile), { recursive: true })
        appendFileSync(logFile, done.map((d) => `${JSON.stringify({ at, path: d.path, id: d.id, archived: d.archived })}\n`).join(''))
      }
    } catch (e) { res.errors.push(`${rel}: ${e.message} (note left as it was)`); continue }
    res.removed.push(...done)
  }
  return res
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
  const src = o.record ?? o.people
  if (typeof o.vault !== 'string' || !existsSync(o.vault) || typeof src !== 'string' || !existsSync(src) || (o.record && o.people)) {
    console.error('usage: notes_cleanup.mjs --vault <dir> --record <record.json> | --people <people.json> [--archive <dir>] [--dry-run]')
    process.exit(2)
  }
  const json = JSON.parse(readFileSync(src, 'utf8'))
  const people = o.record ? json.people : json
  if (!Array.isArray(people)) { console.error(`${src}: no people array`); process.exit(2) }
  const dryRun = o['dry-run'] === true
  const r = cleanup(path.resolve(o.vault), people, { dryRun, ...(typeof o.archive === 'string' ? { archiveDir: path.resolve(o.archive) } : {}) })
  if (dryRun) for (const b of r.removed) console.log(`would remove ${b.id}${b.name ? ` (${b.name})` : ''} from ${b.path} -> ${b.archived}`)
  console.log(JSON.stringify({ dryRun, scanned: r.scanned, removed: r.removed.length, unchanged: r.unchanged, errors: r.errors }))
}
