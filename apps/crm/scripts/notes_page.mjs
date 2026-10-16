// One person as a markdown page in the vault (TrustWeb -> notes direction, 2026-10-16). Pure: text in, text out, no fs.
// Shape (Obsidian and Logseq both render it; the HTML comments stay invisible):
//   ---                       front matter: trustweb id, name, ring, tana link, updated (ISO)
//   ...
//   ---
//   # Name
//   <!-- trustweb:begin -->   the generated block: context, then one bullet per line with a hidden id tag
//   - 2026-07-11 Runs a repair café <!-- tw:<lineId> -->
//   <!-- trustweb:end -->
//   (anything after the end marker is the person's own text: kept on every rewrite; a bullet there is a new line for TrustWeb)
import { createHash } from 'node:crypto'

export const BEGIN = '<!-- trustweb:begin -->'
export const END = '<!-- trustweb:end -->'
export const MARK_FOLDER = '.trustweb-generated'   // an empty file of this name marks the pages folder: the notes reader skips it (no loop)
const TANA_URL = 'https://app.tana.inc?nodeid='
const RINGS = ['close', 'friend', 'acquaintance', 'intending', 'unsorted']
const LINE_RE = /^- (?:(\d{4}-\d{2}-\d{2}) )?(.*?)(?: <!-- tw:([^ ]+) -->)?\s*$/

/** File name for a person: the name, unsafe characters dropped, plus a short id hash so two "Anna Berger" never collide. */
export function slug(person) {
  const base = person.name.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'person'
  return `${base} (${createHash('sha1').update(person.id).digest('hex').slice(0, 6)}).md`
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10)
const esc = (s) => String(s).replace(/\r?\n/g, ' ').trim()
const fmValue = (s) => (/[:#"'\[\]{}|>]|^\s|\s$/.test(s) ? JSON.stringify(s) : s)

/** The whole page for a person; `userText` is what sat after the end marker before (kept verbatim). */
export function renderPage(person, { now = Date.now(), userText = '' } = {}) {
  const fm = [
    `trustweb: ${person.id}`,
    `name: ${fmValue(esc(person.name))}`,
    `ring: ${person.ring}`,
    ...(person.id.startsWith('tana-') ? [`tana: ${TANA_URL}${person.id.slice(5)}`] : []),
    `updated: ${new Date(now).toISOString()}`,
  ]
  const lines = person.lines
    .filter((l) => l.status !== 'gone')
    .map((l) => `- ${day(l.notedAt)} ${esc(l.text)} <!-- tw:${l.id} -->`)
  const body = [
    `# ${esc(person.name)}`,
    BEGIN,
    ...(person.context ? [`- context: ${esc(person.context)}`] : []),
    ...lines,
    END,
  ]
  const tail = userText.replace(/^\n+/, '')
  return `---\n${fm.join('\n')}\n---\n${body.join('\n')}\n${tail ? `\n${tail.replace(/\n*$/, '\n')}` : ''}`
}

/**
 * Reads a page back. Returns null when it is not a TrustWeb page (no trustweb: id).
 * lines = the generated bullets with their ids; userLines = bullets the person wrote after the end marker (new lines for TrustWeb,
 * date = the bullet's own YYYY-MM-DD prefix or none); userText = everything after the end marker, verbatim.
 */
export function parsePage(text) {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!fm) return null
  const meta = {}
  for (const l of fm[1].split('\n')) {
    const m = /^([\w-]+):\s*(.*)$/.exec(l)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('"')) { try { v = JSON.parse(v) } catch { /* keep raw */ } }
    meta[m[1]] = v
  }
  if (!meta.trustweb) return null
  const rest = text.slice(fm[0].length)
  const b = rest.indexOf(BEGIN)
  const e = rest.indexOf(END)
  const generated = b >= 0 && e > b ? rest.slice(b + BEGIN.length, e) : ''
  const userText = e >= 0 ? rest.slice(e + END.length).replace(/^\n+/, '') : ''
  const lines = []
  let context = ''
  for (const l of generated.split('\n')) {
    const m = LINE_RE.exec(l)
    if (!m) continue
    if (!m[1] && !m[3] && m[2].startsWith('context: ')) { context = m[2].slice(9); continue }
    if (m[3]) lines.push({ id: m[3], text: m[2], date: m[1] ?? '' })
  }
  const userLines = []
  for (const l of userText.split('\n')) {
    const m = LINE_RE.exec(l)
    if (m && m[2]) userLines.push({ text: m[2], date: m[1] ?? '' })
  }
  return {
    id: meta.trustweb, name: meta.name ?? '', ring: RINGS.includes(meta.ring) ? meta.ring : '', tana: meta.tana ?? '',
    updated: meta.updated ? Date.parse(meta.updated) : NaN, context, lines, userLines, userText,
  }
}

/** The page rewritten for the person as they are now, the person's own text after the marker kept. Same text in -> same text out when nothing changed. */
export function updatePage(existing, person, { now = Date.now() } = {}) {
  const old = existing ? parsePage(existing) : null
  const next = renderPage(person, { now, userText: old?.userText ?? '' })
  if (old && sameButStamp(existing, next)) return existing
  return next
}

function sameButStamp(a, b) {
  const strip = (s) => s.replace(/^updated: .*$/m, 'updated: -')
  return strip(a) === strip(b)
}

/** What the page says that the record does not: a ring the person changed in the file, and bullets they wrote after the marker. */
export function diffPage(page, person) {
  const have = new Set(person.lines.map((l) => esc(l.text).toLowerCase()))
  const newLines = page.userLines.filter((l) => !have.has(l.text.toLowerCase()))
  const ring = page.ring && page.ring !== person.ring ? page.ring : null
  return { ring, newLines }
}
