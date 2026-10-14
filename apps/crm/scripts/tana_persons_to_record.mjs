// Tana #person export -> bare AppState JSON for the CRM's "Import a TrustWeb export" (and TW_CRM_RECORD).
// File-only, no network. Input is untrusted text: parsed with JSON.parse and regexes, never evaluated.
//   node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GOOGLE = 'Google Calendar Contacts'
const MAX_LINE = 200
const RINGS = { close: 'close', friend: 'friend', acquaintance: 'acquaintance', intending: 'intending' }

function clean(s) {
  return s
    .replace(/<!--.*?-->/g, '')
    .replace(/\[([^\]]*?)(?:\s+#\S+)?\]\(tana:[^)]*\)/g, '$1')
    .trim()
}

/** Top-level bullets of one node outline as note texts; nested and truncated bullets are skipped. */
function lineTexts(outline) {
  const out = []
  for (const raw of outline.split('\n').slice(1)) {
    const m = /^ {2}- (.*)$/.exec(raw)
    if (!m) continue
    const f = /^\*\*(.+?)\*\*:\s*(.*)$/.exec(m[1])
    const text = f ? `${f[1].replace(/:$/, '')}: ${clean(f[2])}` : clean(m[1])
    if (f ? clean(f[2]) : text) out.push(text.slice(0, MAX_LINE))
  }
  return out
}

function ringOf(texts) {
  for (const t of texts) {
    const m = /^ring: (\w+)/i.exec(t)
    if (m && RINGS[m[1].toLowerCase()]) return RINGS[m[1].toLowerCase()]
  }
  return 'acquaintance'
}

/** @returns {{ record: object, stats: { persons: number, lines: number, withoutFields: number } }} */
export function convert(index, nodes) {
  let lines = 0
  let withoutFields = 0
  const people = index.map((n) => {
    const at = Date.parse(n.created)
    const texts = lineTexts(nodes[n.id] ?? '')
    if (texts.length === 0) withoutFields++
    const mk = (text, i, extra = {}) => ({
      id: `tana-${n.id}-${i}`, text, tag: 'note', audience: 'me', status: 'current', notedAt: at, checkedAt: at, ...extra,
    })
    const google = (n.breadcrumb ?? []).includes(GOOGLE)
    const all = texts.map((t, i) => mk(t, i))
    if (google) all.push(mk(GOOGLE, texts.length, { tag: 'custom', customTag: GOOGLE }))
    lines += texts.length
    return { id: `tana-${n.id}`, name: n.name, context: '', ring: ringOf(texts), metAt: at, lines: all }
  })
  const record = {
    v: 1, me: { id: 'me', displayName: 'Tana persons' }, people, peers: [], inventory: [], log: [], notificationsOn: false,
  }
  return { record, stats: { persons: people.length, lines, withoutFields } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [indexPath, nodesPath, outPath] = process.argv.slice(2)
  if (!outPath) {
    console.error('usage: tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json>')
    process.exit(2)
  }
  const { record, stats } = convert(JSON.parse(readFileSync(indexPath, 'utf8')), JSON.parse(readFileSync(nodesPath, 'utf8')))
  writeFileSync(outPath, JSON.stringify(record))
  console.log(`persons ${stats.persons}, note lines ${stats.lines}, persons without any field ${stats.withoutFields}`)
}
