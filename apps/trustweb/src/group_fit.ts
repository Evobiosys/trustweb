// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 (groups-to-join): which groups I could join or help, ranked on this phone only (I1). Scores sit on groups, never on people
 * (rings are not scores). `myTags` reads my profile's interests, else the zone tags I use most. A warm path names who I know there, at
 * most one hop (I8): an actual intro still goes through the intro ask with consent. Pure, no DOM.
 */
import { Ring, ringSlot } from './model'
import type { AppState, Person, TwGroup } from './model'
import { S } from './strings'

type Rec = Pick<AppState, 'people'> & Partial<Pick<AppState, 'groups' | 'profile' | 'zoneTags'>>

const RING_WEIGHT: Partial<Record<Ring, number>> = { [Ring.Closest]: 1, [Ring.Close]: 0.8, [Ring.Friend]: 0.6, [Ring.Acquaintance]: 0.3, [Ring.Intending]: 0.2 }
const weightOf = (p: Person): number => RING_WEIGHT[ringSlot(p)] ?? 0
const norm = (s: string): string => s.trim().toLowerCase()
const NOTE_BOOST = 0.1
const FALLBACK_TAGS = 8
const WARM_MAX = 5

export interface GroupFit { alignment: number; closeness: number; resources: number; total: number; reasons: string[] }
export interface WarmPerson { person: Person; /** The member this person knows; absent for a member. */ via?: Person }

export function myTags(s: Rec): string[] {
  const text = s.profile?.interests?.text
  const own = (text ?? '').split(/[,;\n]/).map(norm).filter(Boolean)
  if (own.length) return [...new Set(own)]
  const count = new Map<string, number>()
  for (const z of Object.values(s.zoneTags ?? {})) for (const id of z.ids) count.set(id, (count.get(id) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, FALLBACK_TAGS).map(([id]) => id)
}

function members(g: TwGroup, s: Rec): Person[] {
  return g.members.map((id) => s.people.find((p) => p.id === id)).filter((p): p is Person => !!p && weightOf(p) > 0)
}

const mentions = (p: Person, tags: readonly string[]): boolean => {
  const text = norm(p.lines.map((l) => l.text).join(' '))
  return tags.some((t) => text.includes(t))
}

export function fit(g: TwGroup, s: Rec): GroupFit {
  const mine = myTags(s)
  const theirs = [...new Set(g.tags.map(norm).filter(Boolean))]
  const shared = theirs.filter((t) => mine.includes(t))
  const union = new Set([...mine, ...theirs]).size
  const here = members(g, s)
  const boost = here.some((p) => mentions(p, theirs)) ? NOTE_BOOST : 0
  const alignment = Math.min(1, (union ? shared.length / union : 0) + boost)
  const closeness = Math.min(1, here.reduce((sum, p) => sum + weightOf(p), 0))
  const resources = (g.resources ?? 0) / 3
  const reasons = [
    shared.length ? S.groups.sharedInterests(shared.length, shared.join(', ')) : '',
    here.length ? S.groups.youKnow(here.length) : '',
    g.resources ? S.groups.resources[g.resources] : '',
  ].filter(Boolean)
  return { alignment, closeness, resources, total: 0.5 * alignment + 0.3 * closeness + 0.2 * resources, reasons }
}

export function rankGroups(s: Rec): Array<{ group: TwGroup; fit: GroupFit }> {
  return (s.groups ?? []).map((group) => ({ group, fit: fit(group, s) }))
    .sort((a, b) => b.fit.total - a.fit.total || a.group.name.localeCompare(b.group.name))
}

export function warmPath(g: TwGroup, s: Rec): WarmPerson[] {
  const here = members(g, s).sort((a, b) => weightOf(b) - weightOf(a) || a.name.localeCompare(b.name))
  const ids = new Set(here.map((m) => m.id))
  const hop = s.people
    .filter((p) => weightOf(p) > 0 && !ids.has(p.id) && p.knows?.some((k) => ids.has(k)))
    .sort((a, b) => weightOf(b) - weightOf(a) || a.name.localeCompare(b.name))
    .map((person) => ({ person, via: here.find((m) => person.knows?.includes(m.id)) }))
  return [...here.map((person) => ({ person })), ...hop].slice(0, WARM_MAX)
}
