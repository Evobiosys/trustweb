// Tana #person export -> bare AppState JSON for the CRM's "Import a TrustWeb export" (and TW_CRM_RECORD).
// File-only, no network. Input is untrusted text: parsed with JSON.parse and regexes, never evaluated.
//   node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]
// Schema defaults to person-schema.md next to the nodes file. Field lines become person.fields (see src/fields.ts), plain bullets note lines.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fieldLabel, parseSchema } from './tana_schema_to_fields.mjs'

const GOOGLE = 'Google Calendar Contacts'
const MAX_LINE = 200
const MAX_VALUE = 500
const RINGS = { close: 'close', friend: 'friend', acquaintance: 'acquaintance', intending: 'intending' }

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
  for (const t of [...texts, ...Object.entries(fields).filter(([k]) => /^adhoc:ring$/i.test(k)).map(([, v]) => `ring: ${v}`)]) {
    const m = /^ring: (\w+)/i.exec(t)
    if (m && RINGS[m[1].toLowerCase()]) return RINGS[m[1].toLowerCase()]
  }
  return 'acquaintance'
}

/** @returns {{ record: object, stats: { persons: number, lines: number, withoutFields: number } }} */
export function convert(index, nodes, schema) {
  const byLabel = new Map(schema.map((f) => [f.label.toLowerCase(), f]))
  let lines = 0
  let withoutFields = 0
  const people = index.map((n) => {
    const at = Date.parse(n.created)
    const { texts, fields } = parseOutline(nodes[n.id] ?? '', byLabel)
    if (texts.length === 0 && Object.keys(fields).length === 0) withoutFields++
    const mk = (text, i, extra = {}) => ({
      id: `tana-${n.id}-${i}`, text, tag: 'note', audience: 'me', status: 'current', notedAt: at, checkedAt: at, ...extra,
    })
    const google = (n.breadcrumb ?? []).includes(GOOGLE)
    const all = texts.map((t, i) => mk(t, i))
    if (google) all.push(mk(GOOGLE, texts.length, { tag: 'custom', customTag: GOOGLE }))
    lines += texts.length
    return { id: `tana-${n.id}`, name: n.name, context: '', ring: ringOf(texts, fields), metAt: at, lines: all, fields }
  })
  const record = {
    v: 1, me: { id: 'me', displayName: 'Tana persons' }, people, peers: [], inventory: [], log: [], notificationsOn: false,
  }
  return { record, stats: { persons: people.length, lines, withoutFields } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [indexPath, nodesPath, outPath, schemaArg] = process.argv.slice(2)
  if (!outPath) {
    console.error('usage: tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]')
    process.exit(2)
  }
  const { record, stats } = convert(
    JSON.parse(readFileSync(indexPath, 'utf8')), JSON.parse(readFileSync(nodesPath, 'utf8')),
    parseSchema(readFileSync(schemaArg ?? path.join(path.dirname(nodesPath), 'person-schema.md'), 'utf8')),
  )
  writeFileSync(outPath, JSON.stringify(record))
  console.log(`persons ${stats.persons}, note lines ${stats.lines}, persons without any field ${stats.withoutFields}`)
}
