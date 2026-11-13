// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 import-obsidian-ai: MCP parity for the Import actions. Tool names use underscores (some clients reject dots):
 * import_sources (= import.sources), import_run (= import.run), import_suggestions_list / import_suggestions_accept (= import.suggestions.list|accept).
 * Like the app, nothing here makes a person: candidates become a staged batch (`serviceImports`) that waits on the Curate page. This server runs in plain
 * node, so it cannot load the app's pipeline (import_pipeline.ts); it builds the same row (key, signature, tag) from the node-safe pieces
 * (import_registry.ts, safe_text.ts; normalizeName copies crm dedup.ts, which has an enum node cannot strip; the note text copies S.obsidian.noteAi / noteSources), and mcp_import_tools.test.mjs proves the two stay the same.
 */
import { renameSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_IMPORT_NOTE, IMPORT_SOURCES, importTagId } from '../../trustweb/src/import_registry.ts'
import { fingerprint } from '../../trustweb/src/safe_text.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Rec extends Obj { v: number; people: { name: string }[]; serviceImports?: Batch[]; extData?: { obsidian?: Obj & { suggestions?: Sugg[]; suggestedAt?: number } } }
interface Row extends Obj { key: string; sig: string }
interface Batch { id: string; at: number; counts: Record<string, number>; rows: Row[]; done: Obj; tag: string; note?: string }
interface Sugg { path: string; name: string; confidence: number; why: string }
interface Cand { name: string; emails?: string[]; phones?: string[]; org?: string; title?: string; note?: string; labels?: string[]; file?: string }

export interface ImportToolsOptions { file: string; write: boolean; allow?: readonly string[]; now?: () => Date; newId?: () => string }

const MAX_CANDIDATES = 500
/** Copy of crm/src/import/dedup.ts normalizeName (a test compares them). */
export const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean).sort().join(' ')
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strs = (v: unknown, max: number, cap: number): string[] => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, cap)
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })

function load(file: string): Rec {
  const r = JSON.parse(readFileSync(file, 'utf8')) as Rec
  if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error(`${file} is not a TrustWeb record`)
  return r
}
function save(file: string, r: Rec): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(r))
  renameSync(tmp, file)
}

/** The same fingerprint as services_import.ts sigOf for a candidate with no chat evidence. */
function rowOf(source: string, c: Cand, ai: boolean, dupe: boolean): Row {
  const checked = source === 'obsidian' || source === 'obsidian-ai'
  const emails = strs(c.emails, 200, 10)
  const phones = strs(c.phones, 60, 10)
  const labels = strs(c.labels, 100, 20)
  const org = str(c.org, 200)
  const title = str(c.title, 200)
  const note = str(c.note, 5000)
  const sig = fingerprint(JSON.stringify([c.name, org || undefined, title || undefined, undefined, emails, phones, 0, 0, 0, undefined, ...(checked ? [note || undefined, labels] : [])]))
  return {
    key: `${source}:${normalizeName(c.name)}`, name: c.name, source, file: str(c.file, 300) || 'mcp', n365: 0, out: 0, in: 0, ids: [],
    ...(org ? { org } : {}), ...(emails.length ? { emails } : {}), ...(phones.length ? { phones } : {}), ...(title ? { title } : {}), ...(note ? { note } : {}), ...(labels.length ? { labels } : {}),
    ...(dupe ? { dupe: true } : {}), ...(ai ? { ai: true } : {}), sig,
  }
}

export function importTools(o: ImportToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const newId = o.newId ?? (() => Math.random().toString(36).slice(2, 10))

  /** Stages rows as one batch (the app's commitPlan shape); rows an earlier batch holds with the same signature are skipped. */
  function stage(r: Rec, source: string, cands: Cand[], ai: boolean): { batch: string; staged: number; skipped: number; tag: string } {
    const known = new Map<string, string>()
    for (const b of [...(r.serviceImports ?? [])].reverse()) for (const x of b.rows) known.set(x.key, x.sig)
    const have = new Set(r.people.map((p) => normalizeName(p.name)))
    const rows: Row[] = []
    let skipped = 0
    for (const c of cands) {
      const row = rowOf(source, c, ai, have.has(normalizeName(c.name)))
      if (known.get(row.key) === row.sig || rows.some((x) => x.key === row.key)) { skipped++; continue }
      rows.push(row)
    }
    const at = now().getTime()
    const id = newId()
    const tag = importTagId(at, [source])
    if (rows.length) r.serviceImports = [{ id, at, counts: { [source]: rows.length }, rows, done: {}, tag, note: DEFAULT_IMPORT_NOTE }, ...(r.serviceImports ?? [])]
    return { batch: id, staged: rows.length, skipped, tag }
  }

  const read: Tool[] = [
    {
      name: 'import_sources', description: 'The import sources TrustWeb knows (id, label, kind: file = picked in the app, candidates = people handed over directly).',
      inputSchema: schema({}),
      run: () => IMPORT_SOURCES.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
    },
    {
      name: 'import_suggestions_list', description: 'People the owner\'s own AI suggested from Obsidian notes that wait for a decision (path, name, confidence, why), best first.',
      inputSchema: schema({}),
      run: () => [...(load(o.file).extData?.obsidian?.suggestions ?? [])].sort((a, b) => b.confidence - a.confidence),
    },
  ]

  const write: Tool[] = [
    {
      name: 'import_run', description: 'Stage people for the Curate page as one import batch tagged import:<date>-<source>. Adds nobody to the web: the owner checks and accepts each row in the app.',
      inputSchema: schema({
        source: { type: 'string', description: 'a source id from import_sources' },
        candidates: { type: 'array', description: `up to ${MAX_CANDIDATES} people`, items: schema({ name: { type: 'string' }, emails: { type: 'array', items: { type: 'string' } }, phones: { type: 'array', items: { type: 'string' } }, org: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, file: { type: 'string' } }, ['name']) },
      }, ['source', 'candidates']),
      run: (a) => {
        const source = str(a.source, 40)
        if (!IMPORT_SOURCES.some((s) => s.id === source)) throw new Error(`unknown source "${source}" (see import_sources)`)
        if (!Array.isArray(a.candidates) || !a.candidates.length) throw new Error('candidates is required')
        if (a.candidates.length > MAX_CANDIDATES) throw new Error(`too many candidates (${a.candidates.length} > ${MAX_CANDIDATES})`)
        const cands = a.candidates.map((c: unknown) => {
          const x = (c ?? {}) as Obj
          const name = str(x.name, 100)
          if (!name) throw new Error('every candidate needs a name')
          return { ...x, name } as Cand
        })
        const r = load(o.file)
        const out = stage(r, source, cands, source === 'obsidian-ai')
        if (out.staged) save(o.file, r)
        return out
      },
    },
    {
      name: 'import_suggestions_accept', description: 'Move suggestions to the Curate page as "from AI, check" rows (nobody is added to the web). Choose by paths, or all:true.',
      inputSchema: schema({ paths: { type: 'array', items: { type: 'string' }, description: 'note paths from import_suggestions_list' }, all: { type: 'boolean' } }),
      run: (a) => {
        const r = load(o.file)
        const ob = r.extData?.obsidian
        const list = ob?.suggestions ?? []
        if (a.all !== true && !Array.isArray(a.paths)) throw new Error('paths or all is required')
        const chosen = a.all === true ? list : list.filter((s) => (a.paths as unknown[]).includes(s.path))
        if (!chosen.length) throw new Error('no suggestion matches')
        const out = stage(r, 'obsidian-ai', chosen.map((s) => ({ name: s.name, file: s.path, note: ['Found by AI in your notes; check it.', s.why ? `- ${s.why}` : '', `Sources: ${s.path}`].filter(Boolean).join('\n') })), true)
        r.extData = { ...r.extData, obsidian: { ...ob, suggestions: list.filter((s) => !chosen.includes(s)), suggestedAt: now().getTime() } }
        save(o.file, r)
        return out
      },
    },
  ]

  return [...read, ...(o.write ? write : [])].filter((t) => !o.allow || o.allow.includes(t.name))
}
