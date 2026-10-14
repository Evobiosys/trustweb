// Tana #person export -> bare AppState JSON for the CRM's "Import a TrustWeb export" (and TW_CRM_RECORD).
// File-only, no network. Input is untrusted text: parsed with JSON.parse and regexes, never evaluated.
//   node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]
// Next to the nodes file the converter also reads person-schema.md, workspaces.json (persons outside the first workspace get a
// "workspace: <name>" tag line) and, when present, environment-index-all.json + environment-nodes.json + environment-schema.md
// (written as record.environments), intending.json (scripts/tana_intending.mjs: { id: { n, since } }, newer than the cached nodes) and first-met.json (scripts/tana_first_met.mjs) for metAt and a context line. Field lines become person.fields (see src/fields.ts), plain bullets note lines.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fieldLabel, parseSchema } from './tana_schema_to_fields.mjs'

const GOOGLE = 'Google Calendar Contacts'
const MAX_LINE = 200
const MAX_VALUE = 500
const RINGS = { close: 'close', friend: 'friend', acquaintance: 'acquaintance', intending: 'intending', family: 'unsorted', unsorted: 'unsorted' }
/** Tana's "ring" options field (its option label -> ring) and the "ring approved" checkbox. */
const RING_FIELD = 'rVfw62lb7BYD'
const RING_APPROVED = '_7wgarGd90ZR'
const TANA_RINGS = { 'close friend': 'close', close: 'close', friend: 'friend', acquaintance: 'acquaintance', 'intending to connect': 'intending', unsorted: 'unsorted' }
const CONNECTION = 'ConGRasNilsz'
const INTENDING = 'UAfC4PcYo2po'
const SINCE = '6A0Y1jShWqIg'
const OLD_INTENDING = 'FcZJGS5EH2on'
export const HIDE = '4J9bhDw1UdTj'
const MET_THROUGH = 'X3aA3ndYjClT'
const FAMILY = 'LNlpliq4GdNI'
const DERIVED = 'ring: derived'
/** The marker line of a person whose ring came from ring-suggestions.json (the UI shows the ring dashed until it is tapped once). */
export const SUGGESTED = 'ring: suggested'

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
  if (field?.type === 'date') return /\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? text
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
  const ids = []
  const fields = {}
  for (const raw of outline.split('\n').slice(1)) {
    const m = /^ {2}- (.*)$/.exec(raw)
    if (!m) continue
    const f = /^\*\*(.+?)\*\*:\s*(.*)$/.exec(m[1])
    if (!f) {
      const text = clean(m[1])
      if (text) {
        texts.push(text.slice(0, MAX_LINE))
        ids.push(/<!-- node-id: (\S+) -->/.exec(m[1])?.[1])
      }
      continue
    }
    const label = fieldLabel(f[1])
    const field = byLabel.get(label.toLowerCase())
    const v = fieldValue(field, f[2])
    if (v === '' || (Array.isArray(v) && v.length === 0)) continue
    addValue(fields, field ? field.id : `adhoc:${label}`, v)
  }
  return { texts, ids, fields }
}

function ringOf(texts, fields) {
  for (const t of [...texts, ...Object.entries(fields).filter(([k]) => /^adhoc:ring$/i.test(k) || k === 'tw-ring').map(([, v]) => `ring: ${v}`)]) {
    const m = /^ring: (\w+)/i.exec(t)
    if (m && RINGS[m[1].toLowerCase()]) return RINGS[m[1].toLowerCase()]
  }
  return undefined
}

/** The desire to connect, 0 to 10 (0 when unreadable). */
const desire = (fields) => Math.max(0, Math.min(10, Math.round(Number(fields[INTENDING])) || 0))

/** First structure from the person's own marks: personal connection is friend; a desire of 1 or more with no closer ring is intending to connect; family is a tag, no ring; everyone else (famous, deceased, an email id included) is unsorted. */
function deriveRing(name, fields) {
  if (name.includes('@')) return 'unsorted'
  return fields[CONNECTION] === true ? 'friend' : 'unsorted'
}

/** Intending to connect = desire of 1 or more and no closer ring. */
const withDesire = (ring, fields) => (ring === 'unsorted' && desire(fields) >= 1 ? 'intending' : ring)

/** Workspace name as plain text: inline-ref spans and tags dropped, entities decoded. */
export function workspaceName(raw) {
  return raw.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

const WORKSPACE = 'workspace'

/**
 * One entity list. Duplicate node ids collapse to the first. `workspaces` (id -> name, first = home) adds the tag line to entities outside home.
 * Persons with "hide in trustweb" ticked (in the outline, or listed in `hidden`) and persons with no name are left out and counted.
 * @returns {{ entities: object[], lines: number, withoutFields: number, hidden: number, blank: number }}
 */
function convertList(index, nodes, schema, workspaces, derive = false, firstMet = {}, hiddenIds = new Set(), intending = {}, suggestions = {}, today = '') {
  const byLabel = new Map(schema.map((f) => [f.label.toLowerCase(), f]))
  const home = workspaces[0]?.id
  const names = new Map(workspaces.map((w) => [w.id, workspaceName(w.name)]))
  let lines = 0
  let withoutFields = 0
  const seen = new Set()
  let hidden = 0
  let blank = 0
  const entities = index.filter((n) => !seen.has(n.id) && seen.add(n.id)).flatMap((n) => {
    const at = Date.parse(n.created)
    const { texts, ids, fields } = parseOutline(nodes[n.id] ?? '', byLabel)
    if (derive) {
      delete fields[OLD_INTENDING]
      const live = intending[n.id]
      if (live) Object.assign(fields, { [INTENDING]: String(live.n), ...(live.since ? { [SINCE]: live.since } : {}) })
    }
    if (derive && (fields[HIDE] === true || hiddenIds.has(n.id))) { hidden++; return [] }
    if (derive && !n.name.trim()) { blank++; return [] }
    if (texts.length === 0 && Object.keys(fields).length === 0) withoutFields++
    const mk = (text, i, extra = {}) => ({
      id: `tana-${n.id}-${i}`, text, tag: 'note', audience: 'me', status: 'current', notedAt: at, checkedAt: at, ...extra,
    })
    const google = (n.breadcrumb ?? []).includes(GOOGLE)
    const all = texts.map((t, i) => mk(t, i, ids[i] ? { tanaId: ids[i] } : {}))
    // The ring, strongest first: a "ring:" line, the Tana ring field (shown dashed while "ring approved" is off), the suggestion, the derived one.
    const tanaRing = derive ? TANA_RINGS[String(fields[RING_FIELD] ?? '').toLowerCase()] : undefined
    const approved = fields[RING_APPROVED] === true
    delete fields[RING_FIELD]
    delete fields[RING_APPROVED]
    const explicit = ringOf(texts, fields)
    const s = derive && !explicit && !tanaRing && desire(fields) < 1 ? suggestions[`tana-${n.id}`] : undefined
    const sRing = RINGS[s?.ring === 'close_friend' ? 'close' : s?.ring]
    const suggested = s && (sRing !== 'unsorted' || s.family || s.intending >= 1) ? s : undefined
    if (suggested) {
      if (suggested.family) fields[FAMILY] = true
      if (suggested.intending >= 1 && !fields[INTENDING]) Object.assign(fields, { [INTENDING]: String(Math.min(10, Math.round(suggested.intending))), ...(today ? { [SINCE]: today } : {}) })
    }
    const ring = withDesire(explicit ?? tanaRing ?? (suggested ? sRing : derive ? deriveRing(n.name, fields) : 'unsorted'), fields)
    if (!explicit && derive && !(tanaRing && approved)) all.push(mk(suggested || tanaRing ? SUGGESTED : DERIVED, all.length))
    if (google) all.push(mk(GOOGLE, all.length, { tag: 'custom', customTag: GOOGLE }))
    const ws = n.workspaceId && n.workspaceId !== home ? names.get(n.workspaceId) : undefined
    if (ws) all.push(mk(`${WORKSPACE}: ${ws}`, all.length, { tag: 'custom', customTag: WORKSPACE }))
    lines += texts.length
    delete fields['tw-ring']
    const met = firstMet[n.id]
    return [{ id: `tana-${n.id}`, name: n.name, context: fields[MET_THROUGH] ? '' : met?.context ?? '', ring, metAt: met?.metAt ?? at, lines: all, fields }]
  })
  return { entities, lines, withoutFields, hidden, blank }
}

/** @returns {{ record: object, stats: { persons: number, lines: number, withoutFields: number, environments: number, hidden: number, blank: number } }} */
export function convert(index, nodes, schema, workspaces = [], env, firstMet = {}, hiddenIds = new Set(), intending = {}, suggestions = {}, today = '') {
  const p = convertList(index, nodes, schema, workspaces, true, firstMet, hiddenIds, intending, suggestions, today)
  const e = env ? convertList(env.index, env.nodes, env.schema, workspaces) : { entities: [] }
  const record = {
    v: 1, me: { id: 'me', displayName: `Tana persons (${p.entities.length})` }, people: p.entities, peers: [], inventory: [], log: [], notificationsOn: false,
    ...(e.entities.length ? { environments: e.entities.map(({ ring, ...rest }) => rest) } : {}),
  }
  return { record, stats: { persons: p.entities.length, lines: p.lines, withoutFields: p.withoutFields, environments: e.entities.length, hidden: p.hidden, blank: p.blank } }
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
    has('first-met.json') ? JSON.parse(read('first-met.json')) : {},
    new Set(has('hidden.json') ? JSON.parse(read('hidden.json')) : []),
    has('intending.json') ? JSON.parse(read('intending.json')) : {},
    has('ring-suggestions.json') ? JSON.parse(read('ring-suggestions.json')) : {},
    new Date().toISOString().slice(0, 10),
  )
  writeFileSync(outPath, JSON.stringify(record))
  console.log(`persons ${stats.persons}, environments ${stats.environments}, note lines ${stats.lines}, persons without any field ${stats.withoutFields}, hidden ${stats.hidden}, blank ${stats.blank}`)
}
