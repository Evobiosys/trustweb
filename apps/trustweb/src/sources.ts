/**
 * Imported sources as a unit (Jakob 2026-10-16): Tana and "your notes" (local markdown files) can each be
 *   - HIDDEN: a view choice on this phone. The web, the names and the cards leave the source out; the notes still answer asks
 *     (threadsForRing reads the record, never this projection), and a flip of the switch brings everything back.
 *   - REMOVED: one shot, after a warning. The persons that only this source made and the lines it added leave the record.
 *     Only a new import brings them back.
 * Which source a person belongs to is their id prefix (tana-<node>, local-<hash>: the converters own those ids);
 * which source a line came from is its provenance (source.kind), or a tanaId on older Tana lines.
 */
import { Provenance } from './model'
import type { AppState, NoteLine, Person } from './model'

export const SOURCES: readonly Provenance[] = [Provenance.Tana, Provenance.Local]

export function sourceOfPerson(p: Pick<Person, 'id'>): Provenance | null {
  if (p.id.startsWith('tana-')) return Provenance.Tana
  if (p.id.startsWith('local-')) return Provenance.Local
  return null
}

/** A line's source: its provenance, Tana by tanaId, else (no provenance at all) the source of the person it sits on (the Tana converter writes none). */
export function sourceOfLine(l: Pick<NoteLine, 'source'> & { tanaId?: string }, owner?: Pick<Person, 'id'>): Provenance | null {
  const k = l.source?.kind
  if (k && SOURCES.includes(k)) return k
  if (l.tanaId) return Provenance.Tana
  return k || !owner ? null : sourceOfPerson(owner)
}

export const hiddenSources = (s: Pick<AppState, 'hiddenSources'>): Provenance[] => (s.hiddenSources ?? []).filter((k): k is Provenance => SOURCES.includes(k as Provenance))

export const sourceHidden = (s: Pick<AppState, 'hiddenSources'>, kind: Provenance): boolean => hiddenSources(s).includes(kind)

/** Stored only while something is hidden (absent = all shown). */
export function setSourceHidden(s: Pick<AppState, 'hiddenSources'>, kind: Provenance, hidden: boolean): void {
  const rest = hiddenSources(s).filter((k) => k !== kind)
  const next = hidden ? [...rest, kind] : rest
  if (next.length) s.hiddenSources = next
  else delete s.hiddenSources
}

export function personShown(s: Pick<AppState, 'hiddenSources'>, p: Pick<Person, 'id'>): boolean {
  const k = sourceOfPerson(p)
  return !k || !sourceHidden(s, k)
}

export function lineShown(s: Pick<AppState, 'hiddenSources'>, l: Pick<NoteLine, 'source'> & { tanaId?: string }, owner?: Pick<Person, 'id'>): boolean {
  const k = sourceOfLine(l, owner)
  return !k || !sourceHidden(s, k)
}

/**
 * The record as the views draw it: hidden sources' persons left out, their lines left out of everybody else.
 * Shallow: the persons kept are the record's own objects, so a tap that edits one edits the record.
 */
export function shown(s: AppState): AppState {
  if (!hiddenSources(s).length) return s
  const people = s.people.filter((p) => personShown(s, p)).map((p) => (p.lines.every((l) => lineShown(s, l, p)) ? p : { ...p, lines: p.lines.filter((l) => lineShown(s, l, p)) }))
  return { ...s, people }
}

export interface SourceCount { people: number; lines: number }

/** What a source holds: the persons it made and the lines it added (to its own persons and to others). */
export function sourceCount(s: Pick<AppState, 'people'>, kind: Provenance): SourceCount {
  let people = 0
  let lines = 0
  for (const p of s.people) {
    if (sourceOfPerson(p) === kind) people++
    for (const l of p.lines) if (sourceOfLine(l, p) === kind) lines++
  }
  return { people, lines }
}

/**
 * One shot: the source leaves the record. A person of this source whose lines also came from somewhere else is not lost:
 * they stay as a person without a source (fresh id), with those lines. Returns what left.
 */
export function removeSource(s: AppState, kind: Provenance, newId: () => string): SourceCount {
  const before = sourceCount(s, kind)
  s.people = s.people.flatMap((p) => {
    const lines = p.lines.filter((l) => sourceOfLine(l, p) !== kind)
    if (sourceOfPerson(p) !== kind) return lines.length === p.lines.length ? [p] : [{ ...p, lines }]
    if (!lines.length) return []
    const { fields: _fields, ringSuggested: _rs, ...rest } = p as Person & { fields?: unknown; ringSuggested?: unknown }
    return [{ ...rest, id: newId(), lines }]
  })
  setSourceHidden(s, kind, false)
  return before
}
