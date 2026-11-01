// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (share page): the pure state behind the Share page. The page picks a zone and two chip rows (Also / Except); Share appends
 * ONE share line (share_sink/share_lines.ts) to the record. Its tuples are derived from the record's lines (the latest line per item
 * wins), so the preview, the person card and enforcement all run the same canAccess on the same store (T12). No DOM, no I/O.
 */
import { termSimilarity, MATCH_THRESHOLD } from './fuzzy'
import type { ColourTag } from './colour_tags'
import { tagsOf } from './colour_tags'
import type { Person } from './model'
import { canAccess } from './share_sink/check'
import { appendShare, previewShare, scopeTuples, type Scope, type ShareLine } from './share_sink/share_lines'
import type { Store, Tuple } from './share_sink/tuples'
import { LADDER, Zone, zoneOfPerson } from './share_sink/zones'

export const DEFAULT_ZONE = Zone.Acquaintance
/** Public < ... < Closest; Self (the owner alone) is not a choice. */
export const ZONE_CHOICES: readonly Zone[] = LADDER.filter((z) => z !== Zone.Self)

export type ChipRow = 'include' | 'exclude'
export type PageState = Scope

/** What the checks read: the people, the colour tags (a person's tags) and the record's share lines. */
export interface Basis { people: readonly Pick<Person, 'id' | 'name' | 'ring' | 'fields'>[]; tags: readonly ColourTag[]; shares?: readonly ShareLine[] }

export interface Candidate { id: string; label: string }

const BY = 'device:this'
const itemId = (id: string): string => `item:${id}`

export const initial = (zone: Zone = DEFAULT_ZONE): PageState => ({ zone, include: [], exclude: [] })

/** A chip sits in one row only. */
export function withChip(s: PageState, row: ChipRow, id: string): PageState {
  const other: ChipRow = row === 'include' ? 'exclude' : 'include'
  return { ...s, [row]: [...new Set([...s[row], id])], [other]: s[other].filter((x) => x !== id) }
}

export const withoutChip = (s: PageState, row: ChipRow, id: string): PageState => ({ ...s, [row]: s[row].filter((x) => x !== id) })

export const candidates = (b: Basis): Candidate[] => [
  ...b.people.map((p) => ({ id: `person:${p.id}`, label: p.name })),
  ...b.tags.map((t) => ({ id: `tag:${t.id}`, label: t.label ?? t.id })),
]

/** Up to five candidates for what was typed: prefix or substring first, then the fuzzy match; the ones already chosen stay out. */
export function suggest(query: string, all: readonly Candidate[], taken: readonly string[], max = 5): Candidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const score = (c: Candidate): number => {
    const l = c.label.toLowerCase()
    return l.startsWith(q) ? 1 : l.includes(q) ? 0.9 : termSimilarity(q, l)
  }
  return all.filter((c) => !taken.includes(c.id)).map((c) => ({ c, s: score(c) })).filter((x) => x.s >= MATCH_THRESHOLD)
    .sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.c)
}

/** The relation store: each person's zone and tags, plus the scope tuples of the latest share line per item. */
export function storeOf(b: Basis): Store {
  const since = new Date(0).toISOString()
  const people: Tuple[] = b.people.flatMap((p) => [
    ...(zoneOfPerson(p) === Zone.Public ? [] : [{ subject: `person:${p.id}`, relation: 'in_zone' as const, object: `zone:${zoneOfPerson(p)}`, since, by: BY }]),
    ...tagsOf(p, b.tags).map((t) => ({ subject: `person:${p.id}`, relation: 'has_tag' as const, object: `tag:${t.id}`, since, by: BY })),
  ])
  const latest = new Map<string, Extract<ShareLine, { op: 'share' }>>()
  for (const l of b.shares ?? []) if (l.op === 'share') latest.set(l.id, l)
  return [...people, ...[...latest.values()].flatMap((l) => scopeTuples(l.scope, l.id, BY, new Date(l.ts)))]
}

/** "n people would see this": the same canAccess as enforcement, on the store plus this scope. Names are for the owner only (I2). */
export function previewOf(b: Basis, scope: Scope, item: string, now: Date): { count: number; names: string[] } {
  const ids = b.people.map((p) => `person:${p.id}`)
  const withoutThis = { ...b, shares: (b.shares ?? []).filter((l) => l.id !== itemId(item)) }
  const seen = previewShare(storeOf(withoutThis), scope, ids, itemId(item), now)
  const name = new Map(b.people.map((p) => [`person:${p.id}`, p.name]))
  return { count: seen.count, names: seen.names.map((id) => name.get(id) ?? id) }
}

/** The record's share lines with this share appended (S5). */
export function shareItem(b: Basis, item: string, scope: Scope, now: Date): ShareLine[] {
  return appendShare(b.shares ?? [], { id: itemId(item), scope, to: `zone:${scope.zone}`, ts: now.toISOString() })
}

/** The shared items a person can see (person card), by the same check. */
export function seenBy(b: Basis, personId: string, now: Date): string[] {
  const store = storeOf(b)
  const items = [...new Set((b.shares ?? []).filter((l) => l.op === 'share').map((l) => l.id))]
  return items.filter((i) => canAccess(store, `person:${personId}`, i, now).allowed).map((i) => i.slice('item:'.length))
}
