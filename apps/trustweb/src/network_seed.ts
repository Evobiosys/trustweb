/** Dev seed (Jakob 2026-10-18): demo connections for the Network view. Pure; dev_record.ts applies it to the seed text only. */
import { Audience, LineStatus, Provenance, Ring, Tag } from './model'
import type { AppState, Person } from './model'

const DUMMIES = ['Dummy Alpha', 'Dummy Beta', 'Dummy Gamma']
/** [a, b] pairs by name (first case-insensitive match; "me" = the centre node), both directions listed. */
const MUTUAL: [string, string][] = [['Kevin', 'Day'], ['Kevin', 'me'], ['Day', 'me'], ['Manuel', 'Kevin'], ['Manuel', 'me']]
const DUMMY_KNOWS: [string, string][] = [['Dummy Alpha', 'Dummy Beta'], ['Dummy Beta', 'Dummy Gamma'], ['Dummy Gamma', 'Dummy Alpha'], ['Dummy Alpha', 'Kevin'], ['Dummy Gamma', 'Kevin']]

function dummy(name: string, now: number): Person {
  return {
    id: 'dummy-' + name.split(' ')[1].toLowerCase(), name, context: '', ring: Ring.Acquaintance, metAt: now,
    lines: [{ id: 'dummy-line-' + name.split(' ')[1].toLowerCase(), text: 'Demo person for the Network view', tag: Tag.Note, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: now, checkedAt: now, source: { kind: Provenance.Demo } }],
  }
}

/** Adds the three dummies and the connections to `s` (mutates); a name that is absent is skipped with a console note. True when anything was added. */
export function addNetworkDemo(s: AppState, now = Date.now()): boolean {
  let changed = false
  for (const n of DUMMIES) if (!s.people.some((p) => p.id === dummy(n, now).id)) { s.people.push(dummy(n, now)); changed = true }
  const find = (name: string): Person | 'me' | undefined =>
    name === 'me' ? 'me' : s.people.find((p) => [p.name, ...p.name.split(/\s+/)].some((w) => w.toLowerCase() === name.toLowerCase()))
  const idOf = (x: Person | 'me'): string => (x === 'me' ? s.me.id : x.id)
  const link = (a: Person | 'me', b: Person | 'me'): void => {
    if (a === 'me' || a.knows?.includes(idOf(b))) return
    a.knows = [...(a.knows ?? []), idOf(b)]
    changed = true
  }
  const pairs: [string, string, boolean][] = [...MUTUAL.map(([a, b]): [string, string, boolean] => [a, b, true]), ...DUMMY_KNOWS.map(([a, b]): [string, string, boolean] => [a, b, false])]
  for (const [an, bn, both] of pairs) {
    const a = find(an)
    const b = find(bn)
    if (!a || !b) { console.info(`[network demo] skipped ${an} - ${bn}: ${!a ? an : bn} not found`); continue }
    link(a, b)
    if (both) link(b, a)
  }
  return changed
}
