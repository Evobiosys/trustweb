// People read from local notes (notes_read_persons.mjs JSONL) -> merged into a TrustWeb dev seed record (AppState v1).
// File-only, no network. One shot and repeatable: every run first drops what an earlier run added from the notes (lines with
// source.kind "local" and persons with a "local-" id), then adds the current reading. So a re-read, a changed vault, or
// `--without local` (exclude the notes) / `--without tana` (exclude Tana) are each one command on the same seed.
//   node scripts/notes_persons_to_record.mjs <people.jsonl>[,more.jsonl] <out.json> --merge <seed.json> [--min-confidence 0.5]
//        [--without local|tana] [--tana-links <vault-file.md>] [--me "<display name>"] [--decisions <file.jsonl>] [--offers <file.json>]
// Matching: a full name (two words or more) joins the seed person with the same name, case-insensitive (so a Tana person keeps
// the tana- id and gains note lines). A single first name creates nobody (owner 2026-11-03): it is a JOIN OFFER per (name, note),
// with the record persons of the same first name as candidates; the owner decides in the Curator (join into one / dismiss), the
// decision lands in --decisions (JSONL, last line per key wins) and every later run honours it. --offers gets the pending ones.
// The out file is rewritten only when its bytes change (a pull every 15 min must not spam .bak copies).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { COMMUNITY_TAG } from './notes_page.mjs'

const MAX_LINE = 200
const TANA_URL = 'https://app.tana.inc?nodeid='

const norm = (s) => s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.,;:'"()[\]]/g, '').trim()
const words = (s) => norm(s).split(' ').filter(Boolean)
const h = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n)
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`)
const DECISIONS = new Set(['join', 'dismiss'])

/** The first name as dedup sees it: first word, lowercased, diacritics folded (import/dedup.ts normalizeName), ß -> ss. */
export function firstNameKey(name) {
  const w = String(name ?? '').trim().split(/\s+/)[0] ?? ''
  return w.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** A join offer's stable key: one per (name, note path). */
export const offerKey = (name, notePath) => h(`${norm(name)}\n${notePath}`, 16)

/** The owner's decisions (JSONL `{ key, decision: 'join'|'dismiss', into?, at }`): last line per key wins; malformed lines (and a join without into) are ignored. */
export function loadDecisions(text) {
  const by = new Map()
  for (const l of String(text ?? '').split('\n')) {
    if (!l.trim()) continue
    let d
    try { d = JSON.parse(l) } catch { continue }
    if (!d || typeof d.key !== 'string' || !d.key || !DECISIONS.has(d.decision) || (d.decision === 'join' && (typeof d.into !== 'string' || !d.into))) continue
    by.delete(d.key)
    by.set(d.key, d)
  }
  return [...by.values()]
}

/** Writes only when the bytes differ; a changed file keeps its previous version as <out>.bak.<ts>. @returns 'written' | 'unchanged' */
export function writeIfChanged(outPath, text, { now = Date.now() } = {}) {
  if (existsSync(outPath)) {
    if (readFileSync(outPath, 'utf8') === text) return 'unchanged'
    copyFileSync(outPath, `${outPath}.bak.${new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15)}`)
  }
  writeFileSync(outPath, text)
  return 'written'
}

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
    .map((p) => ({ ...p, lines: p.lines.filter((l) => !(l.source?.kind === 'local' && l.id.startsWith('local-'))) }))   // vault- lines (written next to a person in the vault, notes bridge) stay
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
 * Merge the readings into the seed. @returns {{ record, stats, matched: Map<string, {id, name, paths: string[]}>, offers }}
 * matched = seed persons (by id) that the notes mention, with the note paths: the tana-links file is written from it.
 * offers = the single-name mentions nobody decided yet: [{ key, name, path, date, context, facts, candidates: [{ id, name }] }].
 */
export function merge(seed, readings, { minConfidence = 0.5, reader = '', decisions = [] } = {}) {
  const record = withoutLocal(seed)
  const byName = new Map()
  for (const p of record.people) byName.set(norm(p.name), p)
  const decided = new Map(decisions.map((d) => [d.key, d]))
  const matched = new Map()
  const stats = { notes: readings.length, mentions: 0, belowConfidence: 0, joinedExisting: 0, newPersons: 0, lines: 0, singleNames: 0, offers: 0, joinedByDecision: 0, dismissed: 0 }
  const fresh = new Map() // norm name -> new local person
  const single = new Map() // offer key -> { r, m }: decided after every full name has made its person (a join may go into one)
  const touch = (person, r) => {
    if (!matched.has(person.id)) { matched.set(person.id, { id: person.id, name: person.name, paths: [] }); if (person.id.startsWith('tana-')) stats.joinedExisting++ }
    matched.get(person.id).paths.push(r.path)
  }
  const addLines = (person, r, m, key, full) => {
    const at = dayMs(r.date)
    const texts = new Set(person.lines.map((l) => norm(l.text)))
    const pathTag = h(r.path, 8)
    let i = 0
    const facts = [...(m.facts ?? [])]
    if (!full && m.context && !m.facts?.length) facts.push(m.context)
    for (const c of r.communities ?? []) {
      const text = `${COMMUNITY_TAG}: ${c}`
      if (texts.has(norm(text))) continue
      texts.add(norm(text))
      person.lines.push({ id: `local-${h(key, 12)}-${pathTag}-c${h(c, 6)}`, text, tag: 'custom', customTag: COMMUNITY_TAG, audience: 'me', status: 'current', notedAt: at, checkedAt: at, source: { kind: 'local', path: r.path } })
      stats.lines++
    }
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
  for (const r of readings) {
    const at = dayMs(r.date)
    for (const m of r.people) {
      stats.mentions++
      if (m.confidence < minConfidence) { stats.belowConfidence++; continue }
      const key = norm(m.name)
      if (words(m.name).length < 2) {   // a first name alone: an offer, never a person (owner 2026-11-03)
        stats.singleNames++
        const k = offerKey(m.name, r.path)
        const o = single.get(k)
        if (!o) { single.set(k, { r, m: { ...m, facts: [...(m.facts ?? [])] } }); continue }
        for (const f of m.facts ?? []) if (!o.m.facts.some((x) => norm(x) === norm(f))) o.m.facts.push(f)
        if (m.context) o.m.context = m.context
        continue
      }
      let person = byName.get(key) ?? [...(m.aliases ?? [])].map((a) => byName.get(norm(a))).find((p) => p && words(p.name).length >= 2)
      if (person) touch(person, r)
      else {
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
      addLines(person, r, m, key, true)
    }
  }
  const byId = new Map([...record.people, ...fresh.values()].map((p) => [p.id, p]))
  const pending = []
  for (const [k, { r, m }] of single) {
    const d = decided.get(k)
    if (d?.decision === 'dismiss') { stats.dismissed++; continue }
    const into = d?.decision === 'join' ? byId.get(d.into) : undefined   // an id the record no longer has: offered again
    if (into) { touch(into, r); addLines(into, r, m, norm(m.name), false); stats.joinedByDecision++; continue }
    pending.push({ key: k, name: m.name, path: r.path, date: r.date, context: m.context ?? '', facts: m.facts })
  }
  for (const p of fresh.values()) if (p.lines.length || p.context) record.people.push(p)   // a name alone is not a person yet
  const offers = pending.map((o) => ({ ...o, candidates: record.people.filter((p) => firstNameKey(p.name) === firstNameKey(o.name)).map((p) => ({ id: p.id, name: p.name })) }))
  stats.offers = offers.length
  return { record, stats, matched, offers }
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
  const o = { positional: [], merge: null, minConfidence: 0.5, without: [], tanaLinks: null, me: '', decisions: null, offers: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--merge') o.merge = argv[++i]
    else if (a === '--min-confidence') o.minConfidence = Number(argv[++i])
    else if (a === '--without') o.without.push(argv[++i])
    else if (a === '--tana-links') o.tanaLinks = argv[++i]
    else if (a === '--me') o.me = argv[++i]
    else if (a === '--decisions') o.decisions = argv[++i]
    else if (a === '--offers') o.offers = argv[++i]
    else o.positional.push(a)
  }
  return o
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2))
  const [inArg, outPath] = o.positional
  if (!inArg || !outPath) {
    console.error('usage: notes_persons_to_record.mjs <people.jsonl>[,more] <out.json> [--merge <seed.json>] [--min-confidence 0.5] [--without local|tana] [--tana-links <file.md>] [--me "<name>"] [--decisions <file.jsonl>] [--offers <file.json>]')
    process.exit(2)
  }
  const readings = loadReadings(inArg.split(',').map((f) => readFileSync(f, 'utf8')))
  const seed = o.merge ? JSON.parse(readFileSync(o.merge, 'utf8')) : { v: 1, me: { id: 'me', displayName: 'Local notes' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false }
  const decisions = o.decisions && existsSync(o.decisions) ? loadDecisions(readFileSync(o.decisions, 'utf8')) : []
  let { record, stats, matched, offers } = merge(seed, o.without.includes('local') ? [] : readings, { minConfidence: o.minConfidence, decisions })
  if (o.without.includes('tana')) record = withoutTana(record)
  if (o.me) record.me = { ...record.me, displayName: o.me }
  const wrote = writeIfChanged(outPath, `${JSON.stringify(record)}\n`)
  if (o.tanaLinks) writeFileSync(o.tanaLinks, tanaLinksMarkdown(matched, readings))
  if (o.offers) writeFileSync(o.offers, `${JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), offers }, null, 1)}\n`)
  console.log(`notes ${stats.notes}, mentions ${stats.mentions} (below confidence ${stats.belowConfidence}, single names ${stats.singleNames}: offers ${stats.offers}, joined by decision ${stats.joinedByDecision}, dismissed ${stats.dismissed}), joined Tana persons ${stats.joinedExisting}, new persons ${stats.newPersons}, note lines ${stats.lines}; people now ${record.people.length} -> ${outPath}${wrote === 'unchanged' ? ' (unchanged)' : ''}`)
}
