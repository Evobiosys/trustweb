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
export const RINGS = ['close', 'friend', 'acquaintance', 'intending', 'unsorted']
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
  const strip = (s) => s.replace(/^updated: .*$/m, 'updated: -').replace(/ · updated: \S+/g, ' · updated: -')
  return strip(a) === strip(b)
}

/** What the page says that the record does not: a ring the person changed in the file, and bullets they wrote after the marker. */
export function diffPage(page, person) {
  const have = new Set(person.lines.map((l) => esc(l.text).toLowerCase()))
  const newLines = page.userLines.filter((l) => !have.has(l.text.toLowerCase()))
  const ring = page.ring && page.ring !== person.ring ? page.ring : null
  return { ring, newLines }
}

// ---- per-note rules (Jakob 2026-10-16): a note can opt out, or put everyone it names into one community ----
//   opt out:   front matter `trustweb: no`, or `no-trustweb` among its tags, or `#no-trustweb` anywhere in the text
//   community: front matter `trustweb-community: DWeb-Berlin_2026` (or `community:`; a list works), or `#community/DWeb-Berlin_2026` in the text
export const COMMUNITY_TAG = 'community'

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  return m ? m[1] : ''
}

export function noteOptOut(text) {
  const fm = frontMatter(text)
  if (/^trustweb\s*:\s*(no|false|off)\s*$/mi.test(fm)) return true
  if (/^tags\s*:.*\bno-trustweb\b/mi.test(fm)) return true
  return /(^|\s)#no-trustweb(?![\w-])/.test(text)
}

/** The communities a note declares, cleaned (no #, no surrounding quotes/brackets), in order, unique. */
export function noteCommunities(text) {
  const out = []
  const add = (v) => { const c = String(v).replace(/^#/, '').replace(/[\[\]"']/g, '').replace(/[.,;:!?)]+$/, '').trim(); if (c && !out.includes(c)) out.push(c) }
  const fm = frontMatter(text)
  for (const m of fm.matchAll(/^(?:trustweb-)?community\s*:\s*(.+)$/gmi)) for (const v of m[1].split(',')) add(v)
  for (const m of text.matchAll(/(^|\s)#community\/([^\s#]+)/g)) add(m[2])
  return out
}

// ---- the block form (Jakob 2026-10-16, "append TrustWeb changes into the existing note where the person was found") ----
// One marked block per person at the end of their home note:
//   <!-- trustweb:begin <id> -->
//   - TrustWeb: Name · ring: friend · https://app.tana.inc?nodeid=… · updated: ISO
//   - 2026-07-11 Plays chess <!-- tw:<lineId> -->
//   - a bullet you add here without a tag is a new line for TrustWeb
//   <!-- trustweb:end <id> -->
// Newer wins per field: a ring edited in the file after the block's `updated` stamp (file mtime later) goes to TrustWeb; else TrustWeb's ring is written.
const BLOCK_RE = /<!-- trustweb:begin ([^ ]+) -->\n([\s\S]*?)<!-- trustweb:end \1 -->\n?/g
const HEAD_RE = /^- TrustWeb: (.*?) · ring: (\w+)(?: · (https:\/\/app\.tana\.inc\S*))? · updated: (\S+)\s*$/

export function renderBlock(person, { now = Date.now(), keep = [] } = {}) {
  const head = `- TrustWeb: ${esc(person.name)} · ring: ${person.ring}${person.id.startsWith('tana-') ? ` · ${TANA_URL}${person.id.slice(5)}` : ''} · updated: ${new Date(now).toISOString()}`
  const lines = person.lines.filter((l) => l.status !== 'gone').map((l) => `- ${day(l.notedAt)} ${esc(l.text)} <!-- tw:${l.id} -->`)
  const kept = keep.map((k) => `- ${k.date ? `${k.date} ` : ''}${k.text}`)
  return `<!-- trustweb:begin ${person.id} -->\n${[head, ...lines, ...kept].join('\n')}\n<!-- trustweb:end ${person.id} -->\n`
}

/** Every block in a note: id, name, ring, updated stamp, tagged lines, and untagged bullets (the person's own additions). */
export function parseBlocks(text) {
  const out = []
  for (const m of text.matchAll(BLOCK_RE)) {
    const b = { id: m[1], name: '', ring: '', updated: NaN, lines: [], userLines: [] }
    for (const l of m[2].split('\n')) {
      const h = HEAD_RE.exec(l)
      if (h) { b.name = h[1]; b.ring = RINGS.includes(h[2]) ? h[2] : ''; b.updated = Date.parse(h[4]); continue }
      const x = LINE_RE.exec(l)
      if (!x || !x[2]) continue
      if (x[3]) b.lines.push({ id: x[3], text: x[2], date: x[1] ?? '' })
      else b.userLines.push({ text: x[2], date: x[1] ?? '' })
    }
    out.push(b)
  }
  return out
}

/**
 * The note with this person's block written: replaced in place when there, else appended. Bullets the person added inside the
 * block stay (until TrustWeb has them as lines, then the tagged line takes their place). Unchanged content -> the same text back.
 */
export function upsertBlock(noteText, person, { now = Date.now() } = {}) {
  const old = parseBlocks(noteText).find((b) => b.id === person.id)
  const have = new Set(person.lines.map((l) => esc(l.text).toLowerCase()))
  const keep = (old?.userLines ?? []).filter((u) => !have.has(u.text.toLowerCase()))
  const block = renderBlock(person, { now, keep })
  const re = new RegExp(`<!-- trustweb:begin ${person.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n[\\s\\S]*?<!-- trustweb:end ${person.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n?`)
  if (old) {
    const cur = re.exec(noteText)[0]
    if (sameButStamp(cur, block)) return noteText
    return noteText.replace(re, block)
  }
  const sep = noteText.length === 0 ? '' : noteText.endsWith('\n\n') ? '' : noteText.endsWith('\n') ? '\n' : '\n\n'
  return `${noteText}${sep}${block}`
}

/**
 * What the file says that the record does not, by the newer-wins rule: the block's ring when the file was saved after the block
 * was written (fileMtime > updated) and differs; the untagged bullets as new lines always (lines only ever get added).
 */
export function blockChanges(block, person, fileMtime) {
  const have = new Set(person.lines.map((l) => esc(l.text).toLowerCase()))
  const newLines = block.userLines.filter((u) => !have.has(u.text.toLowerCase()))
  const fileNewer = Number.isFinite(block.updated) ? fileMtime > block.updated + 1000 : true
  const ring = block.ring && block.ring !== person.ring && fileNewer ? block.ring : null
  return { ring, newLines }
}
