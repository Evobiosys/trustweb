/**
 * The backup guard for the owner's private inventory lines (wave 4, 2026-10-07).
 *
 * Six of his ticked lines are private and must never reach a demo bundle, the
 * seed or the demo peer's inventory. The repository is public, so the lines
 * themselves are NOT here: only the SHA-256 digests of their normalised form
 * (lowercase, whitespace collapsed to single spaces, trimmed).
 *
 * What the scan CAN catch: a private line (or one of its sentences) that appears
 * whole, in any casing or spacing, as a line of a text file, as a JS/TS/JSON
 * string literal (single, double or template; standard escapes decoded) or as
 * a JSON string value.
 * What it can NOT catch: a line split over a concatenation ("a" + "b"), built
 * from `\x`/exotic escapes or char codes, paraphrased or edited text (a changed
 * word is a different digest), a fragment shorter than a sentence inside a longer
 * string with no sentence break, and anything compressed, encoded or inside a binary
 * (images, audio, base64). The allowlist test (demo_inventory_public.test.mjs) is
 * the real guard; this is the net under it.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const PRIVATE_LINE_DIGESTS = Object.freeze([
  'f19598dfda46b779403f1cc0620afb3e7735b7389bc959d00c63c72cc974eb02',
  '7b5c98aab64999c0edf43473f80c00ba51dd4b71ce68bf218537e0de061a4131',
  '664d385834309566542919b19947506b87e6e5b2b96f05371e68d7d5cc2754d1',
  'c600f8fffc73b630ecb47662487e213c194df60bb31f1aea37bb941cb8e52328',
  '095bb6b349b7c532450c1832a518ddd3f0a9e1c65a24de41fa11760b200f28d6',
  'bfbc53ceea66990f3aff10102099fe584a8cf3c98d28101cd94d22b724bd9fbf',
])
const DENY = new Set(PRIVATE_LINE_DIGESTS)

/** Lowercase, whitespace collapsed to single spaces, trimmed. */
export function normaliseLine(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim()
}

export function lineDigest(text) {
  return createHash('sha256').update(normaliseLine(text)).digest('hex')
}

/** `deny`: another digest set (the scanner's own self-test); the real list by default. */
export const isPrivateLine = (text, deny = DENY) => deny.has(lineDigest(text))

const unescapeLiteral = (body) => body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, c) => {
  if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
  if (c[0] === 'x' && c.length === 3) return String.fromCharCode(parseInt(c.slice(1), 16))
  return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c
})

/** Every string literal of a JS/TS/JSON/HTML text, escapes decoded. */
export function stringLiterals(text) {
  const out = []
  const re = /"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|`((?:[^`\\]|\\[\s\S])*)`/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(unescapeLiteral(m[1] ?? m[2] ?? m[3] ?? ''))
  return out
}

function jsonStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => jsonStrings(v, out))
  return out
}

/** A candidate string, its lines and its sentences: the units whose digest is checked. */
function units(candidate) {
  const out = [candidate]
  for (const l of candidate.split(/\r?\n/)) {
    out.push(l)
    for (const s of l.split(/(?<=[.!?])\s+/)) out.push(s)
  }
  return out
}

/** The private-line hits in one text file's content, one per distinct line ([] = clean): a short digest prefix, never the text. */
export function scanText(content, { json = false, deny = DENY } = {}) {
  const candidates = [...content.split(/\r?\n/), ...stringLiterals(content)]
  if (json) {
    try { candidates.push(...jsonStrings(JSON.parse(content))) } catch { /* not JSON: lines and literals still scanned */ }
  }
  const hits = []
  for (const c of candidates) for (const u of units(c)) if (u.trim() && isPrivateLine(u, deny)) hits.push(lineDigest(u).slice(0, 12))
  return [...new Set(hits)]
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.css', '.txt', '.webmanifest', '.svg', '.map'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Scans every text file under a directory; returns { files, hits: [{ file, digest }] }. `deny`: see isPrivateLine. */
export function scanDirectory(dir, deny = DENY) {
  const files = walk(dir).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
  const hits = []
  for (const f of files) for (const digest of scanText(readFileSync(f, 'utf8'), { json: f.endsWith('.json'), deny })) hits.push({ file: f, digest })
  return { files: files.length, hits }
}
