// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 (import-curate): what the owner does on the Curate page BEFORE Accept, as pure steps on the staged rows: sort useful rows first,
 * filter by tag, add / remove tags, set a ring, add a note, edit every field, accept many at once, merge or keep both of a duplicate pair, and
 * undo several imports. Nothing reaches the record except through decide() (services_import.ts); no DOM, no storage.
 */
import { findDuplicates, normalizeName } from '../../crm/src/import/dedup'
import type { ImportedContact } from '../../crm/src/import/types'
import type { ColourTag } from './colour_tags'
import { isUnnamed, rowTags, snapOf, tagSlug } from './import_tags'
import { Ring } from './model'
import type { AppState, Person, ServiceRow } from './model'
import { decide, pendingProposals, personFor, undoBatch } from './services_import'
import type { Pending } from './services_import'
import { createTag } from './tag_create'

export * from './import_tags'

type State = Pick<AppState, 'people' | 'serviceImports'>

const hasContact = (r: ServiceRow): boolean => Boolean(r.emails?.length || r.phones?.length)

/** 3 = name with contact and a tag, 2 = contact, 1 = tag only, 0 = nothing but the name. */
const usefulness = (r: ServiceRow): number => (hasContact(r) ? 2 : 0) + (rowTags(r).length ? 1 : 0)

/** Useful rows first (the order of the proposals is kept inside a class); date-named and phone-only rows apart, for "Unnamed numbers". */
export function sortPending(list: readonly Pending[]): { useful: Pending[]; unnamed: Pending[] } {
  const useful = list.filter((x) => !isUnnamed(x.row))
  return { useful: useful.map((x, i) => ({ x, i })).sort((a, b) => usefulness(b.x.row) - usefulness(a.x.row) || a.i - b.i).map((e) => e.x), unnamed: list.filter((x) => isUnnamed(x.row)) }
}

export const filterByTag = (list: readonly Pending[], label: string | null): Pending[] => (label === null ? [...list] : list.filter((x) => rowTags(x.row).includes(label)))

/** Every label of the pending rows with how many rows carry it, biggest first. */
export function tagCounts(list: readonly Pending[]): { label: string; count: number }[] {
  const n = new Map<string, number>()
  for (const x of list) for (const l of rowTags(x.row)) n.set(l, (n.get(l) ?? 0) + 1)
  return [...n].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** The tag ids for these labels: an existing tag with the same label (any case) is reused, a new label defines a tag. Returns the full list to save and the label -> id map decide() needs. */
export function defineLabelTags(existing: readonly ColourTag[], labels: readonly string[]): { tags: ColourTag[]; tagOf: (label: string) => string; created: ColourTag[] } {
  const tags = [...existing]
  const ids = new Map<string, string>()
  const created: ColourTag[] = []
  for (const l of labels.map((x) => x.trim()).filter(Boolean)) {
    const hit = tags.find((t) => (t.label ?? t.id).toLowerCase() === l.toLowerCase())
    if (hit) { ids.set(l, hit.id); continue }
    const t = createTag(tags, l)
    tags.push(t); created.push(t); ids.set(l, t.id)
  }
  return { tags, tagOf: (label) => ids.get(label.trim()) ?? tagSlug(label), created }
}

// ---- bulk steps and edits on staged rows (before Accept) ----

/** Returns how many rows were visited. */
export function bulkAddLabels(rows: readonly ServiceRow[], labels: readonly string[]): number {
  for (const r of rows) r.labels = [...new Set([...rowTags(r), ...labels.map((l) => l.trim()).filter(Boolean)])]
  return rows.length
}
export function bulkRemoveLabels(rows: readonly ServiceRow[], labels: readonly string[]): number {
  for (const r of rows) { r.labels = rowTags(r).filter((l) => !labels.includes(l)); if (!r.labels.length) delete r.labels }
  return rows.length
}
export function bulkSetRing(rows: readonly ServiceRow[], ring: Ring): number {
  for (const r of rows) r.ring = ring
  return rows.length
}
/** The same note to every row; one that already has a note gets it on a new line. */
export function bulkAppendNote(rows: readonly ServiceRow[], note: string): number {
  const text = note.trim()
  if (text) for (const r of rows) r.note = r.note && !r.note.split('\n').includes(text) ? `${r.note}\n${text}` : r.note ?? text
  return rows.length
}
/** The same connections (chips `person:<id>` / `tag:<id>`) for every row, or taken away again. */
export function bulkConnect(rows: readonly ServiceRow[], chips: readonly string[]): number {
  for (const r of rows) r.connected = union(r.connected, chips)
  return rows.length
}
export function bulkUnconnect(rows: readonly ServiceRow[], chips: readonly string[]): number {
  for (const r of rows) { r.connected = (r.connected ?? []).filter((c) => !chips.includes(c)); if (!r.connected.length) delete r.connected }
  return rows.length
}
/** "By tag -> ring": every pending row with that tag gets the ring. Returns how many. */
export const setRingByTag = (list: readonly Pending[], label: string, ring: Ring): number => bulkSetRing(filterByTag(list, label).map((x) => x.row), ring)

export interface RowPatch { name?: string; emails?: string[]; phones?: string[]; labels?: string[]; note?: string; ring?: Ring; connected?: string[] }
/** Every field of a staged row; an empty list or text takes the field away. */
export function editRow(row: ServiceRow, patch: RowPatch): void {
  if (patch.name !== undefined && patch.name.trim()) row.name = patch.name.trim()
  for (const k of ['emails', 'phones', 'labels', 'connected'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    const list = [...new Set(v.map((x) => x.trim()).filter(Boolean))]
    if (list.length) row[k] = list; else delete row[k]
  }
  if (patch.note !== undefined) { if (patch.note.trim()) row.note = patch.note.trim(); else delete row.note }
  if (patch.ring !== undefined) row.ring = patch.ring
}

/** Accepts the pending rows whose keys are given, in list order. Returns how many. */
export function acceptRows(s: State, keys: ReadonlySet<string>, now: number, newId: () => string, tagOf?: (label: string) => string): number {
  const list = pendingProposals(s, now).filter((x) => keys.has(x.row.key))
  for (const x of list) decide(s, x.batchId, x.row.key, { do: 'accept' }, now, newId, tagOf)
  return list.length
}

/** Accepts every pending row that has no flag and a real name, all on Acquaintances (a contacts file says nothing about closeness). */
export function acceptAllAsAcquaintances(s: State, now: number, newId: () => string, tagOf?: (label: string) => string): number {
  const rows = pendingProposals(s, now).filter((x) => x.proposal.flags.length === 0 && !isUnnamed(x.row))
  bulkSetRing(rows.map((x) => x.row), Ring.Acquaintance)
  return acceptRows(s, new Set(rows.map((x) => x.row.key)), now, newId, tagOf)
}

// ---- the dedupe view: candidate pairs side by side ----

export interface DupeSide { row?: ServiceRow; batchId?: string; person?: Person }
export interface DupePair { a: { row: ServiceRow; batchId: string }; b: DupeSide }

const asContact = (r: ServiceRow): ImportedContact => ({ name: r.name, emails: r.emails ?? [], phones: r.phones ?? [] }) as ImportedContact
const skipped = (r: ServiceRow, other: string): boolean => r.keepBoth?.includes(other) ?? false

/** Pending rows that look like the same person as another pending row, or as someone already in the web; pairs the owner kept apart are left out. */
export function dupePairs(s: State, list: readonly Pending[]): DupePair[] {
  const pairs: DupePair[] = []
  const order = new Map<string, number>()
  for (const b of s.serviceImports ?? []) b.rows.forEach((r, i) => order.set(r.key, i))
  // Date-named and number-only rows are junk to look at, not people to compare by name: they never pair up.
  const byFirst = list.filter((x) => !isUnnamed(x.row)).sort((x, y) => (order.get(x.row.key) ?? 0) - (order.get(y.row.key) ?? 0))
  for (const g of findDuplicates(byFirst.map((x) => asContact(x.row)))) {
    const [first, ...rest] = g.members.map((i) => byFirst[i])
    for (const o of rest) if (!skipped(first.row, `row:${o.row.key}`) && !skipped(o.row, `row:${first.row.key}`)) pairs.push({ a: { row: first.row, batchId: first.batchId }, b: { row: o.row, batchId: o.batchId } })
  }
  for (const x of byFirst) {
    const found = personFor(s, x.row)
    if (found && found.by !== 'key' && !skipped(x.row, `person:${found.person.id}`)) pairs.push({ a: { row: x.row, batchId: x.batchId }, b: { person: found.person } })
  }
  return pairs
}

const union = (a: readonly string[] | undefined, b: readonly string[] | undefined): string[] => [...new Set([...(a ?? []), ...(b ?? [])])]

/** Merge: a row with a row = the second folds into the first (its e-mails, numbers, tags and note join; it is left); a row with a person = accepted into that person, who gets the e-mail and number. */
export function mergePair(s: State, pair: DupePair, now = Date.now(), newId: () => string = () => `m${now}`, tagOf?: (label: string) => string): void {
  const { row: a, batchId } = pair.a
  if (pair.b.person) { decide(s, batchId, a.key, { do: 'accept', confirm: true }, now, newId, tagOf); return }
  const b = pair.b.row!
  const batch = (s.serviceImports ?? []).find((x) => x.id === pair.b.batchId)
  editRow(a, { emails: union(a.emails, b.emails), phones: union(a.phones, b.phones), labels: union(a.labels, b.labels), connected: union(a.connected, b.connected), note: union(a.note?.split('\n'), b.note?.split('\n')).join('\n') })
  delete a.dupe
  if (batch) batch.done[b.key] = { did: 'left' }
}

/** Keep both: the rows are different people; the flag goes so a bulk accept takes them. */
export function keepBoth(_s: State, pair: DupePair): void {
  const other = pair.b.person ? `person:${pair.b.person.id}` : `row:${pair.b.row!.key}`
  pair.a.row.keepBoth = union(pair.a.row.keepBoth, [other])
  delete pair.a.row.dupe
  if (pair.b.row) { pair.b.row.keepBoth = union(pair.b.row.keepBoth, [`row:${pair.a.row.key}`]); delete pair.b.row.dupe }
}

// ---- undo several imports ----

export interface UndoPreview { edited: { personId: string; name: string }[]; untouched: number }

/** Who the owner edited since these imports (highlighted in the list; kept unless "also undo my edits"). */
export function previewUndo(s: State, batchIds: readonly string[]): UndoPreview {
  const out: UndoPreview = { edited: [], untouched: 0 }
  for (const b of (s.serviceImports ?? []).filter((x) => batchIds.includes(x.id))) {
    for (const d of Object.values(b.done)) {
      const p = d.personId ? s.people.find((x) => x.id === d.personId) : undefined
      if (!p) continue
      if (d.snap !== undefined && snapOf(p) !== d.snap) out.edited.push({ personId: p.id, name: p.name }); else out.untouched++
    }
  }
  return out
}

export function undoBatches(s: State, batchIds: readonly string[], opts: { undoEdits?: boolean } = {}): { restored: number; archived: number; kept: number; keptIds: string[] } {
  const sum = { restored: 0, archived: 0, kept: 0, keptIds: [] as string[] }
  // Wave 39 review: newest first, whatever order they were ticked in: an older import's "ring before" must not bring back what a newer one wrote.
  const at = new Map((s.serviceImports ?? []).map((b) => [b.id, b.at]))
  for (const id of [...batchIds].sort((a, b) => (at.get(b) ?? 0) - (at.get(a) ?? 0))) {
    const r = undoBatch(s, id, opts)
    sum.restored += r.restored; sum.archived += r.archived; sum.kept += r.kept; sum.keptIds.push(...r.keptIds)
  }
  return sum
}

export { normalizeName, tagSlug }
