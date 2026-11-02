// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The record turned into the share sink's relation store, and the questions asked of it. The store is derived, never kept, so
 * there is one truth (the record) and one check (the share sink's canAccess): what `sees` reports is what enforcement would do.
 * Pure; the clock is passed in.
 */
import { canAccess, heldTags, personZone } from '../../../apps/trustweb/src/share_sink/check'
import { type ShareLine, scopeTuples } from '../../../apps/trustweb/src/share_sink/share_lines'
import type { Store, Tuple } from '../../../apps/trustweb/src/share_sink/tuples'
import { LADDER, type Zone } from '../../../apps/trustweb/src/share_sink/zones'
import { CliError } from './errors'
import { findZone, nestingTuples } from './ops'
import type { CliRecord, ZoneEntry } from './record'

/** A subject no record can name (`~` is not an id character): the stand-in member when asking what a zone or tag sees. */
const PROBE = 'person:~probe'

/** The rings that are on: the ladder without the levels whose built-in zone is archived. */
export function activeZones(r: CliRecord): Zone[] {
  const off = new Set(r.zones.filter((z) => z.builtin && z.archivedAt).map((z) => z.level))
  return LADDER.filter((z) => !off.has(z))
}

const tagTuples = (r: CliRecord): Tuple[] => [
  ...r.people.flatMap((p) => p.tags.map((t) => ({ subject: `person:${p.id}`, relation: 'has_tag' as const, object: `tag:${t}`, since: p.addedAt, by: r.device }))),
  ...nestingTuples(r),
]

/** The person ids a zone places, with the tag that placed each one that is not a direct member. */
export function zoneMembers(r: CliRecord, id: string): { people: string[]; viaTags: { person: string; tag: string }[] } {
  return membersOf(r, findZone(r, id))
}

function membersOf(r: CliRecord, z: ZoneEntry): { people: string[]; viaTags: { person: string; tag: string }[] } {
  const people = z.members.filter((m) => m.startsWith('person:')).map((m) => m.slice('person:'.length))
  const viaTags = z.members.filter((m) => m.startsWith('tag:')).flatMap((m) => {
    const tag = m.slice('tag:'.length)
    return holdersOf(r, tag).map((person) => ({ person, tag }))
  })
  return { people, viaTags }
}

/** The people who hold a tag, directly or through a tag nested under it. */
export function holdersOf(r: CliRecord, tagId: string): string[] {
  const tags = tagTuples(r)
  return r.people.filter((p) => heldTags(tags, `person:${p.id}`).has(`tag:${tagId}`)).map((p) => p.id)
}

/** Zones that place people: every zone except an archived created one (an archived built-in zone is a ring switched off instead). */
const placing = (r: CliRecord): ZoneEntry[] => r.zones.filter((z) => z.builtin || !z.archivedAt)

/** The relation store this record stands for. */
export function storeOf(r: CliRecord): Store {
  const zoned = new Map<string, Tuple>()
  for (const z of placing(r)) {
    const { people, viaTags } = membersOf(r, z)
    for (const id of [...people, ...viaTags.map((v) => v.person)]) {
      const t: Tuple = { subject: `person:${id}`, relation: 'in_zone', object: `zone:${z.level}`, since: z.createdAt, by: r.device }
      if (!zoned.has(`${t.subject} ${t.object}`)) zoned.set(`${t.subject} ${t.object}`, t)
    }
  }
  const latest = new Map<string, Extract<ShareLine, { op: 'share' }>>()
  for (const l of r.shares) if (l.op === 'share') latest.set(l.id, l)
  const shared = [...latest.values()].flatMap((l) => scopeTuples(l.scope, l.id, r.device, new Date(l.ts)))
  return [...zoned.values(), ...tagTuples(r), ...shared]
}

/** The zone a person counts in: the most intimate ring that is on (the share sink's personZone). */
export const effectiveZoneOf = (r: CliRecord, personId: string, now: Date): Zone => personZone(storeOf(r), `person:${personId}`, now, activeZones(r)).zone

export interface Seen { item: string; why: string[] }
export interface Sight { target: string; notes: string[]; items: Seen[] }

const itemsIn = (store: Store): string[] => [...new Set(store.filter((t) => /^(item|file):/.test(t.object)).map((t) => t.object))].sort()

/** The zones that put `subject` on `zone:<level>`, for the why of an in_zone tuple. */
function placedBy(r: CliRecord, t: Tuple): string {
  const person = t.subject.slice('person:'.length)
  const zones = placing(r).filter((z) => `zone:${z.level}` === t.object).filter((z) => {
    const m = membersOf(r, z)
    return m.people.includes(person) || m.viaTags.some((v) => v.person === person)
  })
  return ` (via ${zones.map((z) => z.id).join(', ')})`
}

function look(r: CliRecord, store: Store, subject: string, now: Date): Seen[] {
  const active = activeZones(r)
  return itemsIn(store).flatMap((item) => {
    const a = canAccess(store, subject, item, now, active)
    if (!a.allowed) return []
    const why = a.why.filter((t) => t.subject !== PROBE).map((t) => `${t.subject} ${t.relation} ${t.object}${t.relation === 'in_zone' ? placedBy(r, t) : ''}`)
    return [{ item, why }]
  })
}

/**
 * What a target can see, with why. `person:<id>`: that person, exactly as enforcement decides. `tag:<id>`: someone who holds only
 * that tag and sits in no zone. A zone id: someone who sits only in that zone. Per-person exclusions show on persons only.
 */
export function sees(r: CliRecord, target: string, now: Date): Sight {
  const store = storeOf(r)
  if (target.startsWith('person:')) {
    const id = target.slice('person:'.length)
    if (!r.people.some((p) => p.id === id)) throw new CliError(`no person ${id} (see: trustweb person list)`)
    return { target, notes: [], items: look(r, store, target, now) }
  }
  if (target.startsWith('tag:')) {
    const id = target.slice('tag:'.length)
    if (!r.tags.some((t) => t.id === id)) throw new CliError(`no tag ${id} (see: trustweb tag list)`)
    const probe: Tuple = { subject: PROBE, relation: 'has_tag', object: target, since: new Date(0).toISOString(), by: r.device }
    return { target, notes: [], items: look(r, [...store, probe], PROBE, now) }
  }
  const z = findZone(r, target)
  const notes: string[] = []
  if (!z.builtin) {
    if (z.archivedAt) return { target: `zone:${z.id}`, notes: [`${z.id} is archived: it places nobody, so it sees nothing`], items: [] }
    notes.push(`${z.id} sits on level ${z.level}: it sees what ${z.level} sees`)
  }
  if (!activeZones(r).includes(z.level)) {
    notes.push(z.builtin ? `${z.id} is archived (ring switched off): someone only in it counts as public` : `level ${z.level} is archived (ring switched off): someone only in ${z.id} counts as public`)
  }
  const probe: Tuple = { subject: PROBE, relation: 'in_zone', object: `zone:${z.level}`, since: new Date(0).toISOString(), by: r.device }
  return { target: `zone:${z.id}`, notes, items: look(r, [...store, probe], PROBE, now) }
}
