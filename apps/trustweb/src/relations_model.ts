// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 (hover-sources): how two of my contacts relate and WHY we think so. Pure, no DOM, no storage.
 * A relation is derived from what the record already holds (Knows lists, shared tags, shared imports, shared events, shared groups) plus
 * what I stated myself (AppState.relations, this device only). Every relation lists its sources; confidence = noisy-or of their weights,
 * 1 only when I stated the kind. A tag, event or group with more than CROWD holders says little about two of them: it only supports a
 * pair that exists for another reason and never creates one.
 */
import type { Person, Ring, TwEvent, TwGroup } from './model'
import { isFamily } from './rings_layout'

export const KINDS = ['close-friends', 'friends', 'acquainted', 'family', 'colleagues', 'unknown'] as const
export type RelationKind = (typeof KINDS)[number]

export type SourceType = 'stated-by-me' | 'stated-by-them' | 'shared-tag' | 'shared-import' | 'co-presence-event' | 'messenger-group' | 'inferred'

/** `detail`: stated-by-me = the kind, or 'knows' (the Knows list); tag = its label; import = its source; event / group = its name; inferred = the ring both sit in (or 'family'). `date`: YYYY-MM-DD when known. `crowd`: the holders were too many to say much. */
export interface RelationSource { type: SourceType; detail: string; date?: string; crowd?: true }

export interface Relation { a: string; b: string; kind: RelationKind; confidence: number; sources: RelationSource[] }

/** What I said about a pair: a kind, or 'none' (not related). `a` < `b`. */
export interface StatedRelation { a: string; b: string; kind: RelationKind | 'none'; at: number }

export interface TagInfo { id: string; label?: string; system?: boolean }

export interface RelationInput {
  me: { id: string }
  people: readonly Person[]
  tags: readonly TagInfo[]
  events?: readonly TwEvent[]
  groups?: readonly TwGroup[]
  relations?: readonly StatedRelation[]
}

/** More holders than this and a shared tag, event or group is background, not evidence. */
export const CROWD = 12

export const WEIGHT: Record<SourceType, number> = {
  'stated-by-me': 0.8, 'stated-by-them': 0.9, 'messenger-group': 0.5, 'co-presence-event': 0.4, 'shared-tag': 0.35, 'shared-import': 0.15, inferred: 0.2,
}
const MAX_DERIVED = 0.95

/** Stroke of the dashed line per kind (close friends = the shortest dashes). */
export const LINE_DASH: Record<RelationKind, string> = {
  'close-friends': '1.5 2', friends: '3 3', acquainted: '2 6', family: '6 2', colleagues: '4 2 1 2', unknown: '2 3',
}

const w = (s: RelationSource): number => (s.crowd ? WEIGHT[s.type] / 3 : WEIGHT[s.type])

/** 1 when I stated the kind; otherwise the noisy-or of the source weights, capped at 0.95, two decimals. */
export function confidenceOf(sources: readonly RelationSource[], stated?: RelationKind): number {
  if (stated) return 1
  const c = 1 - sources.reduce((rest, s) => rest * (1 - w(s)), 1)
  return Math.round(Math.min(c, MAX_DERIVED) * 100) / 100
}

const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const IMPORT_TAG = /^import:(\d{4}-\d{2}-\d{2})-(.+)$/

/** Closeness of a ring for the guess: closest 0 ... acquaintance 3; anything else says nothing about two friends. */
const RANK: Partial<Record<Ring, number>> = { closest: 0, close: 1, family: 1, friend: 2, acquaintance: 3 } as Partial<Record<Ring, number>>
const GUESS: RelationKind[] = ['close-friends', 'close-friends', 'friends', 'acquainted']

/** The pair's relation, replaced or added: one statement per pair. */
export function setStated(s: { relations?: StatedRelation[] }, a: string, b: string, kind: RelationKind | 'none', now: number): void {
  const [x, y] = a < b ? [a, b] : [b, a]
  s.relations = [...(s.relations ?? []).filter((r) => key(r.a, r.b) !== key(x, y)), { a: x, b: y, kind, at: now }]
}

/** Takes my statement back: the pair falls back to what we derive. */
export function clearStated(s: { relations?: StatedRelation[] }, a: string, b: string): void {
  const rest = (s.relations ?? []).filter((r) => key(r.a, r.b) !== key(a, b))
  if (rest.length) s.relations = rest; else delete s.relations
}

export interface RelationIndex {
  /** The relation of a pair, or null: nothing links them (or I said "not related"). */
  relation(a: string, b: string): Relation | null
  /** Everyone this person relates to, most sure first. */
  of(id: string): Relation[]
  /** The pairs that get a dashed line: Knows entries and my statements, never touching me, minus "not related". */
  pairs(): [string, string][]
}

export function relationIndex(input: RelationInput): RelationIndex {
  const byId = new Map(input.people.map((p) => [p.id, p]))
  const stated = new Map((input.relations ?? []).map((r) => [key(r.a, r.b), r]))
  const knownBy = new Map<string, Set<string>>()
  const link = (x: string, y: string): void => { (knownBy.get(x) ?? knownBy.set(x, new Set()).get(x)!).add(y) }
  for (const p of input.people) for (const id of p.knows ?? []) if (id !== p.id && byId.has(id)) { link(p.id, id); link(id, p.id) }

  // Shared things, each with its holders (people on this list only).
  interface Shared { source: Omit<RelationSource, 'crowd'>; holders: Set<string> }
  const shared: Shared[] = []
  for (const t of input.tags) {
    const holders = new Set(input.people.filter((p) => String(p.fields?.[t.id]) === 'true').map((p) => p.id))
    const imp = IMPORT_TAG.exec(t.id)
    if (holders.size > 1) shared.push({ holders, source: imp ? { type: 'shared-import', detail: imp[2], date: imp[1] } : { type: 'shared-tag', detail: t.label ?? t.id } })
  }
  for (const e of input.events ?? []) {
    const holders = new Set(input.people.filter((p) => p.events?.includes(e.id)).map((p) => p.id))
    if (holders.size > 1) shared.push({ holders, source: { type: 'co-presence-event', detail: e.name, date: e.from } })
  }
  for (const g of input.groups ?? []) {
    const holders = new Set(g.members.filter((id) => byId.has(id)))
    if (holders.size > 1) shared.push({ holders, source: { type: 'messenger-group', detail: g.name, date: day(g.updatedAt) } })
  }
  const sharedBy = new Map<string, Shared[]>()
  for (const sh of shared) for (const id of sh.holders) (sharedBy.get(id) ?? sharedBy.set(id, []).get(id)!).push(sh)

  const guess = (pa: Person, pb: Person): { kind: RelationKind; source: RelationSource } | null => {
    if (isFamily(pa) && isFamily(pb)) return { kind: 'family', source: { type: 'inferred', detail: 'family' } }
    const ra = RANK[pa.ring], rb = RANK[pb.ring]
    if (ra === undefined || rb === undefined) return null
    const weaker = Math.max(ra, rb)
    return { kind: GUESS[weaker], source: { type: 'inferred', detail: ra >= rb ? pa.ring : pb.ring } }
  }

  const relation = (a: string, b: string): Relation | null => {
    const pa = byId.get(a), pb = byId.get(b)
    if (!pa || !pb || a === b) return null
    const said = stated.get(key(a, b))
    if (said?.kind === 'none') return null
    const sources: RelationSource[] = []
    if (said) sources.push({ type: 'stated-by-me', detail: said.kind, date: day(said.at) })
    if (knownBy.get(a)?.has(b)) sources.push({ type: 'stated-by-me', detail: 'knows' })
    for (const sh of sharedBy.get(a) ?? []) if (sh.holders.has(b)) sources.push(sh.holders.size > CROWD ? { ...sh.source, crowd: true } : { ...sh.source })
    if (sources.every((x) => x.crowd)) return null   // empty, or only crowds: background, no relation
    const g = said ? null : guess(pa, pb)
    if (g) sources.push(g.source)
    const [x, y] = a < b ? [a, b] : [b, a]
    return { a: x, b: y, kind: said ? said.kind as RelationKind : g?.kind ?? 'unknown', confidence: confidenceOf(sources, said ? said.kind as RelationKind : undefined), sources }
  }

  return {
    relation,
    of(id) {
      const others = new Set<string>(knownBy.get(id))
      for (const r of stated.values()) if (r.a === id) others.add(r.b); else if (r.b === id) others.add(r.a)
      for (const sh of sharedBy.get(id) ?? []) if (sh.holders.size <= CROWD) for (const o of sh.holders) others.add(o)
      others.delete(id)
      return [...others].map((o) => relation(id, o)).filter((r): r is Relation => r !== null)
        .sort((x, y) => y.confidence - x.confidence || (x.a === id ? x.b : x.a).localeCompare(y.a === id ? y.b : y.a))
    },
    pairs() {
      const out = new Map<string, [string, string]>()
      const add = (a: string, b: string): void => { if (a !== input.me.id && b !== input.me.id && relation(a, b)) out.set(key(a, b), a < b ? [a, b] : [b, a]) }
      for (const p of input.people) for (const id of p.knows ?? []) add(p.id, id)
      for (const r of stated.values()) add(r.a, r.b)
      return [...out.values()]
    },
  }
}
