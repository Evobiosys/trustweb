// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 (co-notes): a co-created note is an outline CRDT (conflict-free replicated data type). Every block has a globally unique id; its words,
 * its place (parent + fractional position) and its share level each carry a Lamport stamp [counter, did] and merge last-writer-wins per group, a
 * delete is a tombstone. merge() is commutative, associative and idempotent, so replicas converge in any order. A move that would make a cycle
 * (two people indent into each other) is cut at read time (layout), never refused after the fact. Pure and DOM-free.
 */
import { BLOCK_MAX, BLOCKS_TOTAL_MAX, DEPTH_MAX, TITLE_MAX, parseOutline, type NoteBlock } from '../../notes_outline'
import { stripUnsafe } from '../../safe_text'

export type Stamp = [number, string]
export type ShareLevel = 'me' | 'event' | 'zones'
export interface CoPerson { did: string; name: string }
export interface CoBlock {
  id: string
  parent: string | null
  /** Fractional index key: siblings sort by it (then by id). */
  pos: string
  text: string
  by: CoPerson
  at: number
  share?: ShareLevel
  ai?: true
  del?: true
  st: { text: Stamp; place: Stamp; del?: Stamp; share?: Stamp }
}
export interface CoDoc {
  id: string
  title: string
  /** How this device shows it; never merged, each device keeps its own. */
  mode: 'outline' | 'text'
  blocks: CoBlock[]
  people: CoPerson[]
  logseq?: { graph: string; uuid: string }
  eventId?: string
  kind?: 'note' | 'desires' | 'memories'
  /** My Lamport counter: above every stamp I have seen. */
  clock: number
  titleSt?: Stamp
  /** When each person last changed it (ms), by did; merges by the later time. Drives "Ben edited 2 min ago". */
  seen?: Record<string, number>
}
export interface CoRow { id: string; depth: number; text: string; by: CoPerson; at: number; hasKids: boolean; share?: ShareLevel; ai?: true }

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const BLOCKS_WIRE_MAX = BLOCKS_TOTAL_MAX * 2
const NO_STAMP: Stamp = [0, '']
const POS_RE = /^[0-9A-Za-z]{1,64}$/
const SHARES: readonly string[] = ['me', 'event', 'zones']

/** A key strictly between `a` and `b` ('' = no bound on that side). Falls back to "after a" when the bounds are crossed. */
export function between(a: string, b: string): string {
  if (b && a >= b) b = ''
  let out = ''
  let tied = b !== ''
  for (let i = 0; ; i++) {
    const lo = i < a.length ? DIGITS.indexOf(a[i]) : 0
    const hi = tied && i < b.length ? DIGITS.indexOf(b[i]) : BASE
    if (hi - lo > 1) return out + DIGITS[(lo + hi) >> 1]
    out += DIGITS[lo]
    if (hi > lo) tied = false
  }
}

const cmpStamp = (a: Stamp, b: Stamp): number => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
const cmpStr = (a: unknown, b: unknown): number => { const x = JSON.stringify(a); const y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0 }
/** The value with the greater stamp; equal stamps with different values go to the greater value, so the order of arguments never matters. */
const newer = <T>(sa: Stamp, a: T, sb: Stamp, b: T): [Stamp, T] => {
  const c = cmpStamp(sa, sb) || cmpStr(a, b)
  return c >= 0 ? [sa, a] : [sb, b]
}
const either = <T>(a: T | undefined, b: T | undefined): T | undefined => (a === undefined ? b : b === undefined ? a : cmpStr(a, b) <= 0 ? a : b)

const stampOf = (doc: CoDoc, me: CoPerson): Stamp => [doc.clock + 1, me.did || 'me']
const alive = (doc: CoDoc): number => doc.blocks.filter((b) => !b.del).length
const byId = (doc: CoDoc): Map<string, CoBlock> => new Map(doc.blocks.map((b) => [b.id, b]))
const sortBlocks = (bs: CoBlock[]): CoBlock[] => bs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** Who a block hangs under after cutting cycles (the smallest id of a cycle becomes top level) and orphans (parent unknown or deleted → top level). */
function parents(doc: CoDoc): Map<string, string | null> {
  const live = new Map(doc.blocks.filter((b) => !b.del).map((b) => [b.id, b]))
  const par = new Map<string, string | null>()
  for (const b of live.values()) par.set(b.id, b.parent !== null && live.has(b.parent) && b.parent !== b.id ? b.parent : null)
  const done = new Set<string>()
  for (const start of live.keys()) {
    const path: string[] = []
    let cur: string | null | undefined = start
    while (cur && !done.has(cur) && !path.includes(cur)) { path.push(cur); cur = par.get(cur) }
    if (cur && path.includes(cur)) par.set([...path.slice(path.indexOf(cur))].sort()[0], null)
    path.forEach((p) => done.add(p))
  }
  return par
}

/** Alive blocks grouped by effective parent, each group in order. */
function layout(doc: CoDoc): Map<string | null, CoBlock[]> {
  const par = parents(doc)
  const groups = new Map<string | null, CoBlock[]>()
  for (const b of doc.blocks) {
    if (b.del) continue
    const p = par.get(b.id) ?? null
    groups.set(p, [...(groups.get(p) ?? []), b])
  }
  for (const g of groups.values()) g.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1))
  return groups
}

/** The blocks in reading order with their depth; blocks whose id is in `folded` hide their children. */
export function tree(doc: CoDoc, folded: ReadonlySet<string> = new Set()): CoRow[] {
  const groups = layout(doc)
  const rows: CoRow[] = []
  const walk = (parent: string | null, depth: number): void => {
    for (const b of groups.get(parent) ?? []) {
      const hasKids = (groups.get(b.id)?.length ?? 0) > 0
      rows.push({ id: b.id, depth, text: b.text, by: b.by, at: b.at, hasKids, ...(b.share ? { share: b.share } : {}), ...(b.ai ? { ai: true as const } : {}) })
      if (!folded.has(b.id)) walk(b.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

const cleanText = (t: unknown, max: number): string => stripUnsafe(typeof t === 'string' ? t : '').trim().slice(0, max)

export function newDoc(o: { id: string; title: string; me: CoPerson; at: number }): CoDoc {
  return { id: o.id, title: cleanText(o.title, TITLE_MAX), mode: 'outline', blocks: [], people: [o.me], clock: 0 }
}

type Groups = Map<string | null, CoBlock[]>
interface Ctx { s: Stamp; groups: Groups; all: Map<string, CoBlock> }
type Patch = Omit<Partial<CoBlock>, 'st'> & { st?: Partial<CoBlock['st']> }
interface Change { set?: Map<string, Patch>; add?: CoBlock[] }

/** Applies one change under one fresh stamp. Returns `doc` itself when `fn` answers null. */
function apply(doc: CoDoc, me: CoPerson, fn: (c: Ctx) => Change | null): CoDoc {
  const s = stampOf(doc, me)
  const ch = fn({ s, groups: layout(doc), all: byId(doc) })
  if (!ch) return doc
  const blocks = doc.blocks.map((b) => { const p = ch.set?.get(b.id); return p ? { ...b, ...p, st: { ...b.st, ...p.st } } as CoBlock : b })
  return { ...doc, clock: s[0], blocks: [...blocks, ...(ch.add ?? [])], seen: { ...doc.seen, [s[1]]: Date.now() } }
}

const place = (s: Stamp, parent: string | null, pos: string): Patch => ({ parent, pos, st: { place: s } })
const siblings = (groups: Groups, id: string): { parent: string | null; list: CoBlock[]; i: number } => {
  for (const [parent, list] of groups) { const i = list.findIndex((x) => x.id === id); if (i >= 0) return { parent, list, i } }
  return { parent: null, list: [], i: -1 }
}
const height = (groups: Groups, id: string): number => 1 + Math.max(0, ...(groups.get(id) ?? []).map((k) => height(groups, k.id)))
const depthOf = (groups: Groups, id: string): number => {
  const { parent } = siblings(groups, id)
  return parent === null ? 0 : 1 + depthOf(groups, parent)
}
const randomId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** A new block right behind `afterId` on its level (null: last at top level), with its id. */
export function insertAfter(doc: CoDoc, afterId: string | null, text: string, me: CoPerson, at: number, o: { id?: string; share?: ShareLevel; ai?: true } = {}): { doc: CoDoc; id: string } {
  const id = o.id ?? randomId()
  const out = alive(doc) >= BLOCKS_TOTAL_MAX ? doc : apply(doc, me, ({ s, groups }) => {
    const top = groups.get(null) ?? []
    const at0 = afterId ? siblings(groups, afterId) : { parent: null, list: top, i: top.length - 1 }
    if (afterId && at0.i < 0) return null
    const pos = between(at0.list[at0.i]?.pos ?? '', at0.list[at0.i + 1]?.pos ?? '')
    const block: CoBlock = { id, parent: at0.parent, pos, text: cleanText(text, BLOCK_MAX), by: me, at, ...(o.share ? { share: o.share } : {}), ...(o.ai ? { ai: o.ai } : {}), st: { text: s, place: s, ...(o.share ? { share: s } : {}) } }
    return { add: [block] }
  })
  return { doc: out, id: out === doc ? afterId ?? '' : id }
}

export function editText(doc: CoDoc, id: string, text: string, me: CoPerson): CoDoc {
  const t = cleanText(text, BLOCK_MAX)
  return apply(doc, me, ({ s, all }) => (all.get(id) && !all.get(id)?.del && all.get(id)?.text !== t ? { set: new Map([[id, { text: t, st: { text: s } }]]) } : null))
}

export function setShare(doc: CoDoc, id: string, share: ShareLevel, me: CoPerson): CoDoc {
  return apply(doc, me, ({ s, all }) => (all.get(id) && all.get(id)?.share !== share ? { set: new Map([[id, { share, st: { share: s } }]]) } : null))
}

export function setTitle(doc: CoDoc, title: string, me: CoPerson): CoDoc {
  const t = cleanText(title, TITLE_MAX)
  return t && t !== doc.title ? { ...doc, title: t, titleSt: stampOf(doc, me), clock: doc.clock + 1, seen: { ...doc.seen, [me.did || 'me']: Date.now() } } : doc
}

/** Tab: last child of the block above it. Unchanged doc when it is the first of its level or the tree would get too deep. */
export function indent(doc: CoDoc, id: string, me: CoPerson): CoDoc {
  return apply(doc, me, ({ s, groups }) => {
    const { list, i } = siblings(groups, id)
    if (i < 1 || depthOf(groups, id) + 1 + (height(groups, id) - 1) >= DEPTH_MAX) return null
    const prev = list[i - 1]
    const kids = groups.get(prev.id) ?? []
    return { set: new Map([[id, place(s, prev.id, between(kids[kids.length - 1]?.pos ?? '', ''))]]) }
  })
}

/** Shift-Tab: the sibling right after its parent. */
export function outdent(doc: CoDoc, id: string, me: CoPerson): CoDoc {
  return apply(doc, me, ({ s, groups }) => {
    const { parent } = siblings(groups, id)
    if (parent === null) return null
    const up = siblings(groups, parent)
    return { set: new Map([[id, place(s, up.parent, between(up.list[up.i].pos, up.list[up.i + 1]?.pos ?? ''))]]) }
  })
}

const moveBy = (step: -1 | 1) => (doc: CoDoc, id: string, me: CoPerson): CoDoc => apply(doc, me, ({ s, groups }) => {
  const { parent, list, i } = siblings(groups, id)
  if (i < 0 || !list[i + step]) return null
  const [lo, hi] = step < 0 ? [list[i - 2]?.pos ?? '', list[i - 1].pos] : [list[i + 1].pos, list[i + 2]?.pos ?? '']
  return { set: new Map([[id, place(s, parent, between(lo, hi))]]) }
})
export const moveUp = moveBy(-1)
export const moveDown = moveBy(1)

/** Tombstones the block and everything under it. */
export function remove(doc: CoDoc, id: string, me: CoPerson): CoDoc {
  return apply(doc, me, ({ s, groups, all }) => {
    if (!all.get(id) || all.get(id)?.del) return null
    const set = new Map<string, Patch>()
    const mark = (b: string): void => { set.set(b, { del: true, st: { del: s } }); for (const k of groups.get(b) ?? []) mark(k.id) }
    mark(id)
    return { set }
  })
}

const mergeBlock = (a: CoBlock, b: CoBlock): CoBlock => {
  const [tst, text] = newer(a.st.text, a.text, b.st.text, b.text)
  const [pst, pl] = newer<[string | null, string]>(a.st.place, [a.parent, a.pos], b.st.place, [b.parent, b.pos])
  const [sst, share] = newer(a.st.share ?? NO_STAMP, a.share, b.st.share ?? NO_STAMP, b.share)
  const del = a.st.del && b.st.del ? (cmpStamp(a.st.del, b.st.del) >= 0 ? a.st.del : b.st.del) : a.st.del ?? b.st.del
  const first = cmpStr([a.at, a.by], [b.at, b.by]) <= 0 ? a : b
  return {
    id: a.id, parent: pl[0], pos: pl[1], text, by: first.by, at: first.at,
    ...(share ? { share } : {}), ...(a.ai || b.ai ? { ai: true as const } : {}), ...(del ? { del: true as const } : {}),
    st: { text: tst, place: pst, ...(del ? { del } : {}), ...(share ? { share: sst } : {}) },
  }
}

const topStamp = (d: CoDoc): number => Math.max(d.clock, d.titleSt?.[0] ?? 0, ...d.blocks.flatMap((b) => [b.st.text[0], b.st.place[0], b.st.del?.[0] ?? 0, b.st.share?.[0] ?? 0]))

/** The union of two replicas of one document. Commutative, associative and idempotent; `mode` stays this device's (a). */
export function merge(a: CoDoc, b: CoDoc): CoDoc {
  const blocks = new Map<string, CoBlock>()
  for (const x of [...a.blocks, ...b.blocks]) { const y = blocks.get(x.id); blocks.set(x.id, y ? mergeBlock(y, x) : x) }
  const people = new Map<string, CoPerson>()
  for (const p of [...a.people, ...b.people]) { const q = people.get(p.did); people.set(p.did, !q || p.name < q.name ? p : q) }
  const [titleSt, title] = newer(a.titleSt ?? NO_STAMP, a.title, b.titleSt ?? NO_STAMP, b.title)
  const logseq = either(a.logseq, b.logseq)
  const eventId = either(a.eventId, b.eventId)
  const kind = either(a.kind, b.kind)
  const seen: Record<string, number> = { ...a.seen }
  for (const [did, t] of Object.entries(b.seen ?? {})) seen[did] = Math.max(seen[did] ?? 0, t)
  const out: CoDoc = {
    id: a.id, title, mode: a.mode, blocks: sortBlocks([...blocks.values()]), people: [...people.values()].sort((x, y) => (x.did < y.did ? -1 : 1)),
    ...(logseq ? { logseq } : {}), ...(eventId ? { eventId } : {}), ...(kind ? { kind } : {}), clock: 0, ...(titleSt[0] ? { titleSt } : {}), ...(Object.keys(seen).length ? { seen } : {}),
  }
  out.clock = Math.max(topStamp(a), topStamp(b), topStamp(out))
  return out
}

/** Outliner text ('- ' lines, 2 spaces per level), the same as Logseq and Tana paste it. */
export const toText = (doc: CoDoc): string => tree(doc).map((r) => `${'  '.repeat(r.depth)}- ${r.text}`).join('\n')

/** Longest common subsequence of equal texts: pairs [old index, new index]. */
function align(a: readonly string[], b: readonly string[]): [number, number][] {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out: [number, number][] = []
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { out.push([i++, j++]) } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++
  }
  return out
}

const flatten = (bs: readonly NoteBlock[], depth = 0): { depth: number; text: string }[] => bs.flatMap((b) => [{ depth, text: b.text }, ...flatten(b.children, depth + 1)])

/** Plain text back into the same document: lines that kept their words keep their block, changed ones are edited, new ones inserted, missing ones tombstoned. Unchanged text returns `doc`. */
export function fromText(doc: CoDoc, text: string, me: CoPerson, at: number): CoDoc {
  const lines = flatten(parseOutline(text, me, at))
  const old = tree(doc)
  const pairs = align(old.map((r) => r.text), lines.map((l) => l.text))
  const match = new Map<number, number>(pairs.map(([i, j]) => [j, i]))
  // Between two anchors, leftover old and new lines pair up by position (an edit); the rest is added or removed.
  const used = new Set(pairs.map(([i]) => i))
  const anchors: [number, number][] = [[-1, -1], ...pairs, [old.length, lines.length]]
  for (let k = 0; k < anchors.length - 1; k++) {
    const [oi, nj] = anchors[k]
    const [oe, ne] = anchors[k + 1]
    for (let d = 1; oi + d < oe && nj + d < ne; d++) { match.set(nj + d, oi + d); used.add(oi + d) }
  }
  return apply(doc, me, ({ s, groups, all }) => {
    const set = new Map<string, Patch>()
    const add: CoBlock[] = []
    const stack: { id: string; depth: number }[] = []
    const lastPos = new Map<string | null, string>()
    lines.forEach((l, j) => {
      while (stack.length && stack[stack.length - 1].depth >= l.depth) stack.pop()
      const parent = stack.length ? stack[stack.length - 1].id : null
      const prev = lastPos.get(parent) ?? ''
      const row = match.has(j) ? old[match.get(j) ?? 0] : undefined
      const cur = row ? all.get(row.id) : undefined
      let id: string
      if (cur && row) {
        id = cur.id
        const curParent = siblings(groups, id).parent
        const patch: Patch = {}
        if (cur.text !== l.text) { patch.text = l.text; patch.st = { text: s } }
        if (curParent !== parent || cur.pos <= prev) {
          const pos = between(prev, '')
          Object.assign(patch, { parent, pos }); patch.st = { ...patch.st, place: s }
          lastPos.set(parent, pos)
        } else lastPos.set(parent, cur.pos)
        if (patch.st) set.set(id, patch)
      } else {
        id = randomId()
        const pos = between(prev, '')
        lastPos.set(parent, pos)
        add.push({ id, parent, pos, text: l.text, by: me, at, st: { text: s, place: s } })
      }
      stack.push({ id, depth: l.depth })
    })
    old.forEach((r, i) => { if (!used.has(i)) set.set(r.id, { del: true, st: { del: s } }) })
    return set.size || add.length ? { set, add } : null
  })
}

const stampClean = (v: unknown): Stamp => {
  const [n, d] = Array.isArray(v) ? v : []
  return [typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n < 1e15 ? n : 0, cleanText(d, 200)]
}
const personClean = (v: unknown): CoPerson | null => {
  const o = (v ?? {}) as Record<string, unknown>
  const did = cleanText(o.did, 200)
  return did ? { did, name: cleanText(o.name, 60) || '?' } : null
}

/** A document read from the wire, field by field; null when it is no document. Never throws; caps blocks, texts, people and stamps. */
export function cleanDoc(raw: unknown): CoDoc | null {
  try {
    const o = (raw ?? {}) as Record<string, unknown>
    const id = cleanText(o.id, 40)
    if (!id || !Array.isArray(o.blocks)) return null
    const ids = new Set<string>()
    const blocks: CoBlock[] = []
    for (const r of o.blocks.slice(0, BLOCKS_WIRE_MAX * 2)) {
      const b = (r ?? {}) as Record<string, unknown>
      const bid = cleanText(b.id, 40)
      const by = personClean(b.by)
      const st = (b.st ?? {}) as Record<string, unknown>
      if (!bid || !by || typeof b.pos !== 'string' || !POS_RE.test(b.pos) || ids.has(bid) || blocks.length >= BLOCKS_WIRE_MAX) continue
      ids.add(bid)
      const parent = typeof b.parent === 'string' && b.parent ? cleanText(b.parent, 40) : null
      const del = st.del !== undefined ? stampClean(st.del) : b.del === true ? NO_STAMP : undefined
      const share = typeof b.share === 'string' && SHARES.includes(b.share) ? (b.share as ShareLevel) : undefined
      blocks.push({
        id: bid, parent, pos: b.pos, text: cleanText(b.text, BLOCK_MAX), by, at: typeof b.at === 'number' && Number.isFinite(b.at) ? b.at : 0,
        ...(share ? { share } : {}), ...(b.ai === true ? { ai: true as const } : {}), ...(del ? { del: true as const } : {}),
        st: { text: stampClean(st.text), place: stampClean(st.place), ...(del ? { del } : {}), ...(share ? { share: stampClean(st.share) } : {}) },
      })
    }
    const people = (Array.isArray(o.people) ? o.people : []).slice(0, 50).flatMap((p) => personClean(p) ?? [])
    const lg = (o.logseq ?? {}) as Record<string, unknown>
    const logseq = cleanText(lg.graph, 100) && /^[0-9a-f-]{36}$/i.test(cleanText(lg.uuid, 40)) ? { graph: cleanText(lg.graph, 100), uuid: cleanText(lg.uuid, 40) } : undefined
    const kind = o.kind === 'note' || o.kind === 'desires' || o.kind === 'memories' ? o.kind : undefined
    const eventId = cleanText(o.eventId, 40)
    const clock = typeof o.clock === 'number' && Number.isSafeInteger(o.clock) && o.clock >= 0 && o.clock < 1e15 ? o.clock : 0
    const titleSt = o.titleSt !== undefined ? stampClean(o.titleSt) : undefined
    const seen: Record<string, number> = {}
    for (const [did, t] of Object.entries((o.seen ?? {}) as Record<string, unknown>).slice(0, 50)) {
      if (did !== '__proto__' && did.length <= 200 && typeof t === 'number' && Number.isFinite(t) && t >= 0) seen[did] = t
    }
    return {
      id, title: cleanText(o.title, TITLE_MAX), mode: o.mode === 'text' ? 'text' : 'outline', blocks, people, ...(logseq ? { logseq } : {}),
      ...(eventId ? { eventId } : {}), ...(kind ? { kind } : {}), clock, ...(titleSt ? { titleSt } : {}), ...(Object.keys(seen).length ? { seen } : {}),
    }
  } catch {
    return null
  }
}
