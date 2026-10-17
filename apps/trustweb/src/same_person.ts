/**
 * "Same person" (wave 13, R5): the owner declares two persons (two ids) to be one. Pure and DOM-free.
 * The dropped id is remembered in AppState.sameAs (dropped -> kept), which travels with a device sync so the dropped id never comes back.
 */
import { Ring } from './model'
import type { AppState, Person } from './model'

type Rec = Record<string, unknown>

const isPlain = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The winner, plus every field only the loser has (one level deeper for plain objects such as channels and fields). Nothing of the winner is overwritten. */
export function fillMissing<T extends object>(winner: T, loser: T): T {
  const out = { ...winner } as Rec
  for (const [k, v] of Object.entries(loser)) {
    if (out[k] === undefined) out[k] = v
    else if (isPlain(out[k]) && isPlain(v)) out[k] = { ...v, ...(out[k] as Rec) }
  }
  return out as T
}

/** Winner's person, plus any note line and event tag only the loser has, and every other missing field except the ring-bound ones (a suggested ring or a dot angle would move a confirmed person). */
export function unitePerson(w: Person, l: Person): Person {
  const { ringSuggested: _s, angle: _a, ...rest } = l
  void _s; void _a
  if (w.ring !== Ring.Intending) delete rest.intending
  const out = fillMissing(w, rest as Person)
  const have = new Set(w.lines.map((x) => x.id))
  out.lines = [...w.lines, ...l.lines.filter((x) => !have.has(x.id))]
  if (w.events || l.events) out.events = [...new Set([...(w.events ?? []), ...(l.events ?? [])])]
  return out
}

/** Follows oldId -> keptId links to the end. A cycle (a damaged map; the merge never makes one) ends at its smallest id, the same from every start. */
export function resolveSameAs(map: Record<string, string> | undefined, id: string): string {
  const path: string[] = []
  let cur = id
  while (map && Object.prototype.hasOwnProperty.call(map, cur)) {
    const at = path.indexOf(cur)
    if (at >= 0) return path.slice(at).reduce((a, b) => (b < a ? b : a))
    path.push(cur)
    cur = map[cur]
  }
  return cur
}

export const normName = (n: string): string => n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Pairs of persons with the same normalised name and different ids: advisory only (the owner decides). */
export function possibleDuplicates(people: Person[]): [Person, Person][] {
  const out: [Person, Person][] = []
  const byName = new Map<string, Person[]>()
  for (const p of people) {
    const n = normName(p.name)
    if (!n) continue
    const same = byName.get(n) ?? []
    for (const q of same) out.push([q, p])
    byName.set(n, [...same, p])
  }
  return out
}

/**
 * Makes `dropId` one with `keepId` (mutates `s`): note lines, event tags and every missing field are united, the kept person's own values
 * win, general notes are joined; then `dropId` is removed, remembered in sameAs and replaced wherever it is referenced (meetings, demo ids).
 * Chats are keyed by peer id and stay as they are; a second, different connection of the dropped person is noted in the general note so it is
 * not lost. False when either person is missing or they are the same.
 */
export function mergePersons(s: AppState, keepId: string, dropId: string): boolean {
  const keep = s.people.find((p) => p.id === keepId)
  const drop = s.people.find((p) => p.id === dropId)
  if (!keep || !drop || keep === drop) return false
  const merged = unitePerson(keep, drop)
  merged.metAt = Math.min(keep.metAt, drop.metAt)
  const notes = [keep.generalNote, drop.generalNote]
  if (keep.peerId && drop.peerId && keep.peerId !== drop.peerId) notes.push(`also connected as ${drop.peerId.slice(0, 8)}`)
  const note = [...new Set(notes.filter(Boolean))].join('\n\n')
  if (note) merged.generalNote = note
  s.people = s.people.filter((p) => p !== drop).map((p) => (p === keep ? merged : p))
  s.sameAs = { ...s.sameAs, [dropId]: keepId }
  if (s.sameAs[keepId] === dropId) delete s.sameAs[keepId]
  for (const m of s.meetings ?? []) if (m.personId === dropId) m.personId = keepId
  if (s.demo) s.demo.people = [...new Set(s.demo.people.map((id) => (id === dropId ? keepId : id)))]
  return true
}
