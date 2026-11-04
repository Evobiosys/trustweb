// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 (shared-notes): a note is an outline of blocks. Friends add notes under a block (annotations), and a note travels onward with
 * its provenance: who wrote it, who passed it on, and every block keeps its own author. Plain outliner text ('- ' lines, 2-space or tab
 * indent, as Logseq and Tana paste it) goes in and out unchanged, so a later sync needs no data change. Pure and DOM-free.
 */
import { stripUnsafe } from './safe_text'

export type NotePerm = 'read' | 'annotate'
export interface NoteBy { did: string; name: string }
export interface NoteBlock { id: string; text: string; children: NoteBlock[]; by: NoteBy; at: number; annotation?: true }
export interface NoteHop { by: NoteBy; at: number; to: string }
export interface SharedNote {
  id: string
  title: string
  blocks: NoteBlock[]
  origin: { by: NoteBy; at: number }
  chain: NoteHop[]
  perms: NotePerm
}

export const TITLE_MAX = 120
export const BLOCK_MAX = 500
export const BLOCKS_TOTAL_MAX = 500
export const DEPTH_MAX = 6
const SN_KEY = 'sn'

const clean = (t: unknown, max: number): string => stripUnsafe(typeof t === 'string' ? t : '').trim().slice(0, max)
const LINE_RE = /^([ \t]*)(?:[-*] )?(.*)$/

/** Outliner text to blocks authored by `by` at `at`. Indent: a tab or two spaces per level; a jump of more than one level attaches to the nearest parent. */
export function parseOutline(text: string, by: NoteBy, at: number): NoteBlock[] {
  const roots: NoteBlock[] = []
  const stack: NoteBlock[] = []
  let n = 0
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(raw)
    const body = clean(m?.[2], BLOCK_MAX)
    if (!body || n >= BLOCKS_TOTAL_MAX) continue
    const level = Math.min((m?.[1] ?? '').replace(/\t/g, '  ').length >> 1, stack.length, DEPTH_MAX - 1)
    const block: NoteBlock = { id: `b${++n}`, text: body, children: [], by, at }
    stack.length = level
    ;(level ? stack[level - 1].children : roots).push(block)
    stack.push(block)
  }
  return roots
}

/** Blocks back to outliner text (annotations are plain child lines here; their authors stay in the record). */
export function serializeOutline(blocks: readonly NoteBlock[], depth = 0): string {
  return blocks.map((b) => [`${'  '.repeat(depth)}- ${b.text}`, ...(b.children.length ? [serializeOutline(b.children, depth + 1)] : [])].join('\n')).join('\n')
}

const countBlocks = (bs: readonly NoteBlock[]): number => bs.reduce((n, b) => n + 1 + countBlocks(b.children), 0)

export function newNote(o: { title: string; text: string; by: NoteBy; at: number }): SharedNote {
  return { id: `n${o.at.toString(36)}${o.by.did.slice(-4)}`, title: clean(o.title, TITLE_MAX), blocks: parseOutline(o.text, o.by, o.at), origin: { by: o.by, at: o.at }, chain: [], perms: 'annotate' }
}

/** Rebuilds the tree with `fn` applied to the block `id`; null when the id is not in it. */
function mapBlock(bs: readonly NoteBlock[], id: string, fn: (b: NoteBlock) => NoteBlock): NoteBlock[] | null {
  let hit = false
  const out = bs.map((b) => {
    if (b.id === id) { hit = true; return fn(b) }
    const kids = hit ? null : mapBlock(b.children, id, fn)
    if (!kids) return b
    hit = true
    return { ...b, children: kids }
  })
  return hit ? out : null
}

export const canAnnotate = (note: SharedNote, me: NoteBy): boolean => note.origin.by.did === me.did || note.perms === 'annotate'

/** Adds a child note under a block, marked as an annotation by `by`. Throws when `by` may not add notes or the block is unknown. */
export function annotate(note: SharedNote, blockId: string, text: string, by: NoteBy, at: number): SharedNote {
  if (!canAnnotate(note, by)) throw new Error('read only')
  const body = clean(text, BLOCK_MAX)
  if (!body || countBlocks(note.blocks) >= BLOCKS_TOTAL_MAX) throw new Error('nothing to add')
  const child: NoteBlock = { id: `a${at.toString(36)}-${countBlocks(note.blocks) + 1}`, text: body, children: [], by, at, annotation: true }
  const blocks = mapBlock(note.blocks, blockId, (b) => ({ ...b, children: [...b.children, child] }))
  if (!blocks) throw new Error('unknown block')
  return { ...note, blocks }
}

/** Changes the words of a block; only its author may. */
export function editBlock(note: SharedNote, blockId: string, text: string, by: NoteBy): SharedNote {
  const body = clean(text, BLOCK_MAX)
  let allowed = true
  const blocks = mapBlock(note.blocks, blockId, (b) => {
    allowed = b.by.did === by.did
    return allowed && body ? { ...b, text: body } : b
  })
  if (!blocks || !allowed || !body) throw new Error('cannot edit')
  return { ...note, blocks }
}

/** The onward copy: chain extended, every block keeps its author and time. The permission can go down, never up. */
export function forward(note: SharedNote, to: string, by: NoteBy, at: number, perms: NotePerm = note.perms): SharedNote {
  return { ...note, chain: [...note.chain, { by, at, to: clean(to, TITLE_MAX) }], perms: note.perms === 'read' ? 'read' : perms }
}

/** 'written by you' | 'from Anna' | 'from Anna, passed on by Ben, you'. */
export function provenanceLine(note: SharedNote, me: NoteBy): string {
  const who = (b: NoteBy): string => (b.did === me.did ? 'you' : b.name)
  if (note.origin.by.did === me.did) return 'written by you'
  const seen = new Set([note.origin.by.did])
  const passers = note.chain.filter((h) => !seen.has(h.by.did) && seen.add(h.by.did)).map((h) => who(h.by))
  return `from ${who(note.origin.by)}${passers.length ? `, passed on by ${passers.join(', ')}` : ''}`
}

const toB64 = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64 = (s: string): string => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))

/** `base` (an invite link, may hold a fragment) + the note in the fragment, which a browser never sends to a server. */
export function noteShareLink(base: string, note: SharedNote): string {
  return `${base}${base.includes('#') ? '&' : '#'}${SN_KEY}=${toB64(JSON.stringify(note))}`
}

const cleanBy = (b: unknown): NoteBy | null => {
  const o = (b ?? {}) as Record<string, unknown>
  const did = clean(o.did, 200)
  return did ? { did, name: clean(o.name, 60) || '?' } : null
}
const cleanAt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function cleanBlocks(raw: unknown, depth: number, budget: { n: number }): NoteBlock[] {
  if (!Array.isArray(raw) || depth >= DEPTH_MAX) return []
  const out: NoteBlock[] = []
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>
    const by = cleanBy(o.by)
    const text = clean(o.text, BLOCK_MAX)
    if (!by || !text || budget.n >= BLOCKS_TOTAL_MAX) continue
    budget.n++
    out.push({ id: clean(o.id, 40) || `b${budget.n}`, text, children: cleanBlocks(o.children, depth + 1, budget), by, at: cleanAt(o.at), ...(o.annotation === true ? { annotation: true as const } : {}) })
  }
  return out
}

/** The note a link carries, cleaned field by field; null when it carries none or is damaged. Never throws. */
export function parseNoteShare(hash: string): SharedNote | null {
  try {
    const raw = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(SN_KEY)
    if (!raw) return null
    const o = JSON.parse(fromB64(raw)) as Record<string, unknown>
    const origin = (o.origin ?? {}) as Record<string, unknown>
    const by = cleanBy(origin.by)
    const blocks = cleanBlocks(o.blocks, 0, { n: 0 })
    const id = clean(o.id, 40)
    if (!by || !id || !blocks.length) return null
    const chain = (Array.isArray(o.chain) ? o.chain : []).slice(0, 20).flatMap((h: Record<string, unknown>) => {
      const hb = cleanBy(h?.by)
      return hb ? [{ by: hb, at: cleanAt(h.at), to: clean(h.to, TITLE_MAX) }] : []
    })
    return { id, title: clean(o.title, TITLE_MAX), blocks, origin: { by, at: cleanAt(origin.at) }, chain, perms: o.perms === 'annotate' ? 'annotate' : 'read' }
  } catch {
    return null
  }
}
