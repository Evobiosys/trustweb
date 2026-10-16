/** Pure parts of the notes sync (notes_sync.svelte.ts): the payload for the bridge and how the vault's changes land in the record. */
import { Provenance } from '../../trustweb/src/model'
import type { NoteLine, Person, Ring } from '../../trustweb/src/model'
import { effectivePerson } from './person_view'

export interface Change { id: string; path: string; ring: string | null; newLines: { text: string; date: string }[] }
export interface PushResult { written: number; unchanged: number; noHome: number; pages: number; errors: string[] }

/** The people as the Curator sees them (ring and name edits folded in), for the bridge. */
export function peoplePayload(people: readonly Person[], edits: Record<string, Record<string, unknown>> | undefined): Person[] {
  return people.map((p) => effectivePerson(p, edits?.[p.id] as never))
}

export interface ApplyHooks {
  setRing(personId: string, ring: Ring): void
  addLine(personId: string, line: NoteLine): void
  now(): number
  newId(): string
}

/** Applies what the vault said: rings first, then each added bullet as a line with local provenance (the note's path). */
export function applyChanges(changes: readonly Change[], people: readonly Person[], h: ApplyHooks): { rings: number; lines: number } {
  let rings = 0
  let lines = 0
  const RINGS = new Set(['close', 'friend', 'acquaintance', 'intending', 'unsorted'])
  for (const c of changes) {
    const p = people.find((x) => x.id === c.id)
    if (!p) continue
    if (c.ring && RINGS.has(c.ring) && c.ring !== p.ring) { h.setRing(p.id, c.ring as Ring); rings++ }
    const have = new Set(p.lines.map((l) => l.text.trim().toLowerCase()))
    for (const n of c.newLines) {
      const text = n.text.trim()
      if (!text || have.has(text.toLowerCase())) continue
      have.add(text.toLowerCase())
      const at = n.date ? Date.parse(`${n.date}T12:00:00Z`) : h.now()
      h.addLine(p.id, { id: h.newId(), text, tag: 'note' as NoteLine['tag'], audience: 'me' as NoteLine['audience'], status: 'current' as NoteLine['status'], notedAt: at, checkedAt: at, source: { kind: Provenance.Local, path: c.path } })
      lines++
    }
  }
  return { rings, lines }
}
