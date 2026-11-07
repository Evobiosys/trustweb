// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Edit stream (wave 37): the dev server compares the record it holds with the record a personal preview posts and appends one line per
 * user edit (vite_dev_record.mjs -> dev-edits.jsonl). `applyEdit` plays a line back onto a record (scripts/replay_edits.mjs). Pure and
 * DOM-free; no runtime imports, so node runs it directly.
 *
 * Person edits are patches: `after` holds the changed keys with their new values, `before` the same keys with the old ones; a key in
 * `before` but not in `after` was removed. `add`: before null, after the whole person. Hard removal (purge): before the person, after null.
 * `merge`: ids [dropped, kept], before the dropped person, after the merged kept person.
 */
export type EditKind = 'merge' | 'archive' | 'unarchive' | 'delete' | 'restore' | 'ring-move' | 'rename' | 'note' | 'field' | 'add'
type Obj = Record<string, unknown>
export interface Edit { at: string; previewId: string; kind: EditKind; ids: string[]; before: Obj | null; after: Obj | null }
interface Rec { people: Obj[]; sameAs?: Record<string, string>; meetings?: Obj[]; demo?: { people: string[] } }

const NONE = 'none'
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const byId = (r: Rec): Map<string, Obj> => new Map(r.people.map((p) => [p.id as string, p]))

function personKind(before: Obj, after: Obj, keys: string[]): EditKind {
  if (before.deleted_at === undefined && after.deleted_at !== undefined) return 'delete'
  if (before.deleted_at !== undefined && after.deleted_at === undefined) return 'restore'
  if (keys.includes('ring')) return after.ring === NONE ? 'archive' : before.ring === NONE ? 'unarchive' : 'ring-move'
  if (keys.length === 1 && keys[0] === 'name') return 'rename'
  if (keys.length === 1 && keys[0] === 'generalNote') return 'note'
  return 'field'
}

/** One Edit per user change between two records of the same person list; empty when nothing changed. */
export function diffRecords(prev: Rec, next: Rec, meta: { at: string; previewId: string }): Edit[] {
  const out: Edit[] = []
  const a = byId(prev)
  const b = byId(next)
  const seen = new Set<string>()
  for (const [drop, keep] of Object.entries(next.sameAs ?? {})) {
    if (prev.sameAs?.[drop] === keep || !a.has(drop) || b.has(drop)) continue
    out.push({ ...meta, kind: 'merge', ids: [drop, keep], before: a.get(drop)!, after: b.get(keep) ?? null })
    seen.add(drop); seen.add(keep)
  }
  for (const [id, was] of a) {
    if (seen.has(id)) continue
    const now = b.get(id)
    if (!now) { out.push({ ...meta, kind: 'delete', ids: [id], before: was, after: null }); continue }
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => !same(was[k], now[k]))
    if (!keys.length) continue
    const pick = (p: Obj) => Object.fromEntries(keys.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))
    out.push({ ...meta, kind: personKind(was, now, keys), ids: [id], before: pick(was), after: pick(now) })
  }
  for (const [id, now] of b) if (!a.has(id) && !seen.has(id)) out.push({ ...meta, kind: 'add', ids: [id], before: null, after: now })
  return out
}

/** Plays one edit onto a record (a new object; the input stays untouched). An edit about a person the record lacks is skipped. */
export function applyEdit<R extends Rec>(rec: R, e: Edit): R {
  const r = structuredClone(rec)
  const at = (id: string) => r.people.findIndex((p) => p.id === id)
  if (e.kind === 'add') { if (e.after && at(e.ids[0]) < 0) r.people.push(structuredClone(e.after)); return r }
  if (e.kind === 'merge') {
    const [drop, keep] = e.ids
    const k = at(keep)
    if (k < 0 || at(drop) < 0 || !e.after) return r
    r.people = r.people.filter((p) => p.id !== drop).map((p) => (p.id === keep ? structuredClone(e.after!) : p))
    r.sameAs = { ...r.sameAs, [drop]: keep }
    for (const m of r.meetings ?? []) if (m.personId === drop) m.personId = keep
    if (r.demo) r.demo.people = [...new Set(r.demo.people.map((id) => (id === drop ? keep : id)))]
    return r
  }
  const i = at(e.ids[0])
  if (i < 0) return r
  if (!e.after) { r.people.splice(i, 1); return r }
  for (const k of Object.keys(e.before ?? {})) if (!(k in e.after)) delete r.people[i][k]
  Object.assign(r.people[i], structuredClone(e.after))
  return r
}
