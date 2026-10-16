// People read from local notes (notes_read_persons.mjs JSONL) -> merged into a TrustWeb dev seed record (AppState v1).
// File-only, no network. One shot and repeatable: every run first drops what an earlier run added from the notes (lines with
// source.kind "local" and persons with a "local-" id), then adds the current reading. So a re-read, a changed vault, or
// `--without local` (exclude the notes) / `--without tana` (exclude Tana) are each one command on the same seed.
//   node scripts/notes_persons_to_record.mjs <people.jsonl>[,more.jsonl] <out.json> --merge <seed.json> [--min-confidence 0.5]
//        [--without local|tana] [--tana-links <vault-file.md>] [--me "<display name>"]
// Matching: a full name (two words or more) joins the seed person with the same name, case-insensitive (so a Tana person keeps
// the tana- id and gains note lines); a single first name never joins a Tana person (too ambiguous; the Curator's dedup can).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MAX_LINE = 200
const TANA_URL = 'https://app.tana.inc?nodeid='

const norm = (s) => s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.,;:'"()[\]]/g, '').trim()
const words = (s) => norm(s).split(' ').filter(Boolean)
const h = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n)
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`)

/** Read one or more JSONL files; a note read twice keeps its last line. */
export function loadReadings(texts) {
  const by = new Map()
  for (const t of texts) for (const l of t.split('\n')) {
    if (!l.trim()) continue
    const r = JSON.parse(l)
    by.set(r.path, r)
  }
  return [...by.values()]
}

/** Strip what an earlier run added from the notes: local-sourced lines everywhere, persons that only the notes made. */
export function withoutLocal(record) {
  const people = record.people
    .filter((p) => !p.id.startsWith('local-'))
    .map((p) => ({ ...p, lines: p.lines.filter((l) => l.source?.kind !== 'local') }))
  return { ...record, people }
}

/** Strip Tana: persons with a tana- id and (defensively) tana-sourced lines. A person in both sources keeps the local half as a local person. */
export function withoutTana(record) {
  const people = record.people.flatMap((p) => {
    const lines = p.lines.filter((l) => l.source?.kind !== 'tana' && !l.tanaId)
    if (!p.id.startsWith('tana-')) return [{ ...p, lines }]
    const local = lines.filter((l) => l.source?.kind === 'local')
    if (!local.length) return []
    const { fields: _f, ringSuggested: _r, ...rest } = p
    return [{ ...rest, id: `local-${h(norm(p.name), 12)}`, ring: 'unsorted', metAt: Math.min(...local.map((l) => l.notedAt)), lines: local, fields: {} }]
  })
  return { ...record, people }
}

/**
 * Merge the readings into the seed. @returns {{ record, stats, matched: Map<string, {id, name, paths: string[]}> }}
 * matched = seed persons (by id) that the notes mention, with the note paths: the tana-links file is written from it.
 */
export function merge(seed, readings, { minConfidence = 0.5, reader = '' } = {}) {
  const record = withoutLocal(seed)
  const byName = new Map()
  for (const p of record.people) byName.set(norm(p.name), p)
  const matched = new Map()
  const stats = { notes: readings.length, mentions: 0, belowConfidence: 0, joinedExisting: 0, newPersons: 0, lines: 0, singleNames: 0 }
  const fresh = new Map() // norm name -> new local person
  for (const r of readings) {
    const at = dayMs(r.date)
    for (const m of r.people) {
      stats.mentions++
      if (m.confidence < minConfidence) { stats.belowConfidence++; continue }
      const key = norm(m.name)
      const full = words(m.name).length >= 2
      let person = full ? (byName.get(key) ?? [...(m.aliases ?? [])].map((a) => byName.get(norm(a))).find((p) => p && words(p.name).length >= 2)) : undefined
      if (person) {
        if (!matched.has(person.id)) { matched.set(person.id, { id: person.id, name: person.name, paths: [] }); if (person.id.startsWith('tana-')) stats.joinedExisting++ }
        matched.get(person.id).paths.push(r.path)
      } else {
        if (!full) stats.singleNames++
        person = fresh.get(key)
        if (!person) {
          person = { id: `local-${h(key, 12)}`, name: m.name, context: m.context ?? '', ring: 'unsorted', metAt: at, lines: [], fields: {} }
          fresh.set(key, person)
          byName.set(key, person)
          stats.newPersons++
        }
        if (!person.context && m.context) person.context = m.context
        const met = m.met ? dayMs(m.met) : at
        if (met < person.metAt) person.metAt = met
      }
      const texts = new Set(person.lines.map((l) => norm(l.text)))
      const pathTag = h(r.path, 8)
      let i = 0
      const facts = [...(m.facts ?? [])]
      if (!full && m.context && !m.facts?.length) facts.push(m.context)
      for (const f of facts) {
        const text = f.slice(0, MAX_LINE)
        if (texts.has(norm(text))) continue
        texts.add(norm(text))
        person.lines.push({
          id: `local-${h(key, 12)}-${pathTag}-${i++}`, text, tag: 'note', audience: 'me', status: 'current', notedAt: at, checkedAt: at,
          source: { kind: 'local', path: r.path, ...(r.reader || reader ? { reader: r.reader ?? reader } : {}) },
        })
        stats.lines++
      }
    }
  }
  for (const p of fresh.values()) if (p.lines.length) record.people.push(p)
  return { record, stats, matched }
}

/** The vault-side reference: each Tana person the notes mention, with the Tana link and the notes (as wikilinks by file name). */
export function tanaLinksMarkdown(matched, readings) {
  const dates = new Map(readings.map((r) => [r.path, r.date]))
  const rows = [...matched.values()].filter((m) => m.id.startsWith('tana-')).sort((a, b) => a.name.localeCompare(b.name))
  const lines = ['# People in these notes who are also in Tana', '', `Written by TrustWeb's notes import (${new Date().toISOString().slice(0, 10)}); regenerated on every run, do not edit.`, '']
  for (const m of rows) {
    const notes = [...new Set(m.paths)].sort().map((p) => `[[${path.basename(p, '.md')}]] (${dates.get(p)})`).join(', ')
    lines.push(`- [[${m.name}]] — Tana: ${TANA_URL}${m.id.slice(5)} — in: ${notes}`)
  }
  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const o = { positional: [], merge: null, minConfidence: 0.5, without: [], tanaLinks: null, me: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--merge') o.merge = argv[++i]
    else if (a === '--min-confidence') o.minConfidence = Number(argv[++i])
    else if (a === '--without') o.without.push(argv[++i])
    else if (a === '--tana-links') o.tanaLinks = argv[++i]
    else if (a === '--me') o.me = argv[++i]
    else o.positional.push(a)
  }
  return o
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2))
  const [inArg, outPath] = o.positional
  if (!inArg || !outPath) {
    console.error('usage: notes_persons_to_record.mjs <people.jsonl>[,more] <out.json> [--merge <seed.json>] [--min-confidence 0.5] [--without local|tana] [--tana-links <file.md>] [--me "<name>"]')
    process.exit(2)
  }
  const readings = loadReadings(inArg.split(',').map((f) => readFileSync(f, 'utf8')))
  const seed = o.merge ? JSON.parse(readFileSync(o.merge, 'utf8')) : { v: 1, me: { id: 'me', displayName: 'Local notes' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false }
  let { record, stats, matched } = merge(seed, o.without.includes('local') ? [] : readings, { minConfidence: o.minConfidence })
  if (o.without.includes('tana')) record = withoutTana(record)
  if (o.me) record.me = { ...record.me, displayName: o.me }
  if (existsSync(outPath)) copyFileSync(outPath, `${outPath}.bak.${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`)
  writeFileSync(outPath, `${JSON.stringify(record)}\n`)
  if (o.tanaLinks) writeFileSync(o.tanaLinks, tanaLinksMarkdown(matched, readings))
  console.log(`notes ${stats.notes}, mentions ${stats.mentions} (below confidence ${stats.belowConfidence}, single names ${stats.singleNames}), joined Tana persons ${stats.joinedExisting}, new persons ${stats.newPersons}, note lines ${stats.lines}; people now ${record.people.length} -> ${outPath}`)
}
