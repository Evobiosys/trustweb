// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 (co-notes): name chips inside block text (`@[Name](did)` / `@[Name](tw:<personId>)`), what leaves the phone, and the Logseq link and markdown. Pure. */
import type { CoDoc } from './co_doc'
import { tree } from './co_doc'

export type ChipPart = { text: string } | { chip: { name: string; ref: string } }

const CHIP_RE = /@\[([^\]\n]{1,60})\]\(([^)\s]{1,200})\)/g
const EDIT_RE = /@\[([^\]\n]{1,60})\]/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROPERTY_RE = /^\s*(?:[-*]\s+)?([A-Za-z][\w-]*)::\s*(.*)$/

/** 53-bit string hash (cyrb53) in base 36: the same on every device, different for different dids. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The id of a person's name block in a Desires or Memories note, from the whole did (a did:peer:2 ends with the relay address everyone shares). */
export const headId = (did: string): string => `h-${hash53(did)}`

export const chipToken = (name: string, ref: string): string => `@[${name.replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim()}](${ref})`
export const isLocalRef = (ref: string): boolean => ref.startsWith('tw:')

/** Text split into plain pieces and chips. */
export function parseChips(text: string): ChipPart[] {
  const out: ChipPart[] = []
  let at = 0
  for (const m of text.matchAll(CHIP_RE)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) })
    out.push({ chip: { name: m[1], ref: m[2] } })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/** A `tw:` chip names someone only this phone knows; on the way out it is just the name. */
export const degradeChips = (text: string): string => text.replace(CHIP_RE, (all, name: string, ref: string) => (isLocalRef(ref) ? `@${name}` : all))

/** What a person types in a block: chips without their reference. */
export const toEdit = (text: string): string => text.replace(CHIP_RE, (_all, name: string) => `@[${name}]`)

/** Typed text back to stored text: `@[Name]` gets the reference known for that name; unknown names stay plain. */
export const fromEdit = (text: string, refs: ReadonlyMap<string, string>): string => text.replace(EDIT_RE, (all, name: string) => (refs.has(name) ? chipToken(name, refs.get(name) ?? '') : all))

/** Name → reference for every chip in the document, so editing a block keeps its chips. */
export function refsOf(doc: CoDoc, into: Map<string, string> = new Map()): Map<string, string> {
  for (const b of doc.blocks) for (const p of parseChips(b.text)) if ('chip' in p) into.set(p.chip.name, p.chip.ref)
  return into
}

/** The copy that leaves this phone: local chips degraded, lines kept at "me" (and everything under them) left out. */
export function forSend(doc: CoDoc): CoDoc {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]))
  const hidden = (id: string | null, seen = new Set<string>()): boolean => {
    const b = id ? byId.get(id) : undefined
    return !!b && !seen.has(b.id) && (b.share === 'me' || hidden(b.parent, seen.add(b.id)))
  }
  return { ...doc, blocks: doc.blocks.filter((b) => !hidden(b.id)).map((b) => ({ ...b, text: degradeChips(b.text) })) }
}

export interface LogseqRef { graph: string; uuid: string }

/** `logseq://graph/<g>?block-id=<uuid>` or `<g>/<uuid>`; null for anything else. */
export function parseLogseqRef(input: string): LogseqRef | null {
  const s = input.trim()
  try {
    if (s.startsWith('logseq://')) {
      const u = new URL(s)
      const graph = decodeURIComponent(u.pathname.replace(/^\//, '')) || decodeURIComponent(u.hostname === 'graph' ? '' : u.hostname)
      const uuid = u.searchParams.get('block-id') ?? ''
      return graph && UUID_RE.test(uuid) ? { graph: graph.slice(0, 100), uuid } : null
    }
    const i = s.lastIndexOf('/')
    const graph = s.slice(0, i).trim()
    return i > 0 && graph && UUID_RE.test(s.slice(i + 1)) ? { graph: graph.slice(0, 100), uuid: s.slice(i + 1) } : null
  } catch {
    return null
  }
}

export const logseqUrl = (r: LogseqRef): string => `logseq://graph/${encodeURIComponent(r.graph)}?block-id=${r.uuid}`

/** Logseq markdown: chips as [[Name]] page references; the first block carries the `id::` property when the note is linked. */
export function toLogseq(doc: CoDoc): string {
  return tree(doc).map((r, i) => {
    const pad = '  '.repeat(r.depth)
    const id = i === 0 && doc.logseq ? `\n${pad}  id:: ${doc.logseq.uuid}` : ''
    return `${pad}- ${r.text.replace(CHIP_RE, (_a, name: string) => `[[${name}]]`)}${id}`
  }).join('\n')
}

/** Logseq markdown to outliner text: `key:: value` lines are dropped, the id of the first block is kept. */
export function fromLogseq(md: string): { text: string; uuid?: string } {
  const lines: string[] = []
  let blocks = 0
  let uuid: string | undefined
  for (const line of md.split(/\r?\n/)) {
    const prop = PROPERTY_RE.exec(line)
    if (!prop) { if (line.trim()) { lines.push(line); if (/^\s*[-*]\s/.test(line)) blocks++ } continue }
    if (prop[1] === 'id' && blocks === 1 && !uuid && UUID_RE.test(prop[2].trim())) uuid = prop[2].trim()
  }
  return { text: lines.join('\n'), ...(uuid ? { uuid } : {}) }
}
