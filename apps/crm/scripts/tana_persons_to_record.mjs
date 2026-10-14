// Tana #person export -> bare AppState JSON for the CRM's "Import a TrustWeb export" (and TW_CRM_RECORD).
// File-only, no network. Input is untrusted text: parsed with JSON.parse and regexes, never evaluated.
//   node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]
// Next to the nodes file the converter also reads person-schema.md, workspaces.json (persons outside the first workspace get a
// "workspace: <name>" tag line) and, when present, environment-index-all.json + environment-nodes.json + environment-schema.md
// (written as record.environments). Field lines become person.fields (see src/fields.ts), plain bullets note lines.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fieldLabel, parseSchema } from './tana_schema_to_fields.mjs'

const GOOGLE = 'Google Calendar Contacts'
const MAX_LINE = 200
const MAX_VALUE = 500
const RINGS = { close: 'close', friend: 'friend', acquaintance: 'acquaintance', intending: 'intending', none: 'none' }
const FAMILY = 'LNlpliq4GdNI'
const CONNECTION = 'ConGRasNilsz'
const OUT_OF_WEB = ['6QzDHIfrlmSz', '__XNQ42Dtiwx'] // famous, Deceased
const DERIVED = 'ring: derived'

function clean(s) {
  return s
    .replace(/<!--.*?-->/g, '')
    .replace(/\[([^\]]*?)(?:\s+#\S+)?\]\(tana:[^)]*\)/g, '$1')
    .trim()
}

const REF = /\[([^\]]*?)(?:\s+#\S+)?\]\(tana:([^)]*)\)/g

/** One field line's value by the schema type; unknown fields (no `field`) are read as plain text or checkbox. */
function fieldValue(field, raw) {
  const text = clean(raw).slice(0, MAX_VALUE)
  if (field?.type === 'checkbox' || (!field && /^\[[ xX]\]$/.test(text))) return /\[[xX]\]/.test(text)
  if (field?.type === 'instance') {
    const refs = [...raw.matchAll(REF)].map((m) => ({ label: m[1].trim(), tanaId: m[2] }))
    return refs.length ? refs : text
  }
  return text
}

function addValue(fields, key, v) {
  const prev = fields[key]
  if (prev === undefined) fields[key] = v
  else if (typeof prev === 'string' && typeof v === 'string') fields[key] = `${prev}; ${v}`
  else if (Array.isArray(prev) && Array.isArray(v)) fields[key] = [...prev, ...v]
}

/** Top-level bullets of one node outline: plain bullets become note texts, `**Field**: value` bullets structured values; nested and truncated bullets are skipped. */
function parseOutline(outline, byLabel) {
  const texts = []
  const fields = {}
  for (const raw of outline.split('\n').slice(1)) {
    const m = /^ {2}- (.*)$/.exec(raw)
    if (!m) continue
    const f = /^\*\*(.+?)\*\*:\s*(.*)$/.exec(m[1])
    if (!f) {
      const text = clean(m[1])
      if (text) texts.push(text.slice(0, MAX_LINE))
      continue
    }
    const label = fieldLabel(f[1])
    const field = byLabel.get(label.toLowerCase())
    const v = fieldValue(field, f[2])
    if (v === '' || (Array.isArray(v) && v.length === 0)) continue
    addValue(fields, field ? field.id : `adhoc:${label}`, v)
  }
  return { texts, fields }
}

function ringOf(texts, fields) {
  for (const t of [...texts, ...Object.entries(fields).filter(([k]) => /^adhoc:ring$/i.test(k) || k === 'tw-ring').map(([, v]) => `ring: ${v}`)]) {
    const m = /^ring: (\w+)/i.exec(t)
    if (m && RINGS[m[1].toLowerCase()]) return RINGS[m[1].toLowerCase()]
  }
  return undefined
}

/** First structure from the person's own marks; an email or calendar id as name stays out of the web. */
function deriveRing(name, fields) {
  if (name.includes('@')) return 'none'
  if (fields[FAMILY] === true) return 'close'
  if (fields[CONNECTION] === true) return 'friend'
  if (OUT_OF_WEB.some((k) => fields[k] === true)) return 'none'
  return 'acquaintance'
}

/** Workspace name as plain text: inline-ref spans and tags dropped, entities decoded. */
export function workspaceName(raw) {
  return raw.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

const WORKSPACE = 'workspace'

/**
 * One entity list. Duplicate node ids collapse to the first. `workspaces` (id -> name, first = home) adds the tag line to entities outside home.
 * @returns {{ entities: object[], lines: number, withoutFields: number }}
 */
function convertList(index, nodes, schema, workspaces, derive = false) {
  const byLabel = new Map(schema.map((f) => [f.label.toLowerCase(), f]))
  const home = workspaces[0]?.id
  const names = new Map(workspaces.map((w) => [w.id, workspaceName(w.name)]))
  let lines = 0
  let withoutFields = 0
  const seen = new Set()
  const entities = index.filter((n) => !seen.has(n.id) && seen.add(n.id)).map((n) => {
    const at = Date.parse(n.created)
    const { texts, fields } = parseOutline(nodes[n.id] ?? '', byLabel)
    if (texts.length === 0 && Object.keys(fields).length === 0) withoutFields++
    const mk = (text, i, extra = {}) => ({
      id: `tana-${n.id}-${i}`, text, tag: 'note', audience: 'me', status: 'current', notedAt: at, checkedAt: at, ...extra,
    })
    const google = (n.breadcrumb ?? []).includes(GOOGLE)
    const all = texts.map((t, i) => mk(t, i))
    const explicit = ringOf(texts, fields)
    const ring = explicit ?? (derive ? deriveRing(n.name, fields) : 'acquaintance')
    if (!explicit && derive) all.push(mk(DERIVED, all.length))
    if (google) all.push(mk(GOOGLE, all.length, { tag: 'custom', customTag: GOOGLE }))
    const ws = n.workspaceId && n.workspaceId !== home ? names.get(n.workspaceId) : undefined
    if (ws) all.push(mk(`${WORKSPACE}: ${ws}`, all.length, { tag: 'custom', customTag: WORKSPACE }))
    lines += texts.length
    delete fields['tw-ring']
    return { id: `tana-${n.id}`, name: n.name, context: '', ring, metAt: at, lines: all, fields }
  })
  return { entities, lines, withoutFields }
}

/** @returns {{ record: object, stats: { persons: number, lines: number, withoutFields: number, environments: number } }} */
export function convert(index, nodes, schema, workspaces = [], env) {
  const p = convertList(index, nodes, schema, workspaces, true)
  const e = env ? convertList(env.index, env.nodes, env.schema, workspaces) : { entities: [] }
  const record = {
    v: 1, me: { id: 'me', displayName: `Tana persons (${p.entities.length})` }, people: p.entities, peers: [], inventory: [], log: [], notificationsOn: false,
    ...(e.entities.length ? { environments: e.entities.map(({ ring, ...rest }) => rest) } : {}),
  }
  return { record, stats: { persons: p.entities.length, lines: p.lines, withoutFields: p.withoutFields, environments: e.entities.length } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [indexPath, nodesPath, outPath, schemaArg] = process.argv.slice(2)
  if (!outPath) {
    console.error('usage: tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]')
    process.exit(2)
  }
  const dir = path.dirname(nodesPath)
  const read = (f) => readFileSync(path.join(dir, f), 'utf8')
  const has = (f) => existsSync(path.join(dir, f))
  const env = has('environment-index-all.json')
    ? { index: JSON.parse(read('environment-index-all.json')), nodes: JSON.parse(read('environment-nodes.json')), schema: parseSchema(read('environment-schema.md')) }
    : undefined
  const { record, stats } = convert(
    JSON.parse(readFileSync(indexPath, 'utf8')), JSON.parse(readFileSync(nodesPath, 'utf8')),
    parseSchema(schemaArg ? readFileSync(schemaArg, 'utf8') : read('person-schema.md')),
    has('workspaces.json') ? JSON.parse(read('workspaces.json')) : [], env,
  )
  writeFileSync(outPath, JSON.stringify(record))
  console.log(`persons ${stats.persons}, environments ${stats.environments}, note lines ${stats.lines}, persons without any field ${stats.withoutFields}`)
}
