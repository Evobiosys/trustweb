// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * What the commands have in common when they read or change a record: the ladder's default labels, a zone's state,
 * the "must exist" checks with the hint that fixes them, and the two ways a tuple changes (added once; closed, never
 * deleted). Pure on the record object; saving is the command's `ctx.commit`.
 */
import { CommandError } from './cli.ts'
import type { PersonEntry, TagEntry, TrustRecord, ZoneEntry } from './record.ts'
import { Zone, LADDER, isLive, personZone, storeOf, activeZones, type Relation, type Tuple } from './sink.ts'

/** The ladder's words (zones.ts), as a zone is labelled until renamed. */
export const ZONE_LABELS: Readonly<Record<Zone, string>> = {
  [Zone.Public]: 'Public',
  [Zone.Intending]: 'Intending to connect',
  [Zone.Acquaintance]: 'Acquaintances',
  [Zone.Community]: 'Community',
  [Zone.Friend]: 'Friends',
  [Zone.Close]: 'Close friends and allies',
  [Zone.Closest]: 'Closest few',
  [Zone.Self]: 'Self',
}

export type ZoneState = 'always-on' | 'on' | 'archived' | 'not set up'

export const isStructural = (z: Zone): boolean => z === Zone.Public || z === Zone.Self

export function zoneState(r: Pick<TrustRecord, 'zones'>, z: Zone): ZoneState {
  if (isStructural(z)) return 'always-on'
  const e = r.zones[z]
  return e === undefined ? 'not set up' : e.archivedAt === undefined ? 'on' : 'archived'
}

export const zoneLabel = (r: Pick<TrustRecord, 'zones'>, z: Zone): string => r.zones[z]?.label ?? ZONE_LABELS[z]

/** The zone's entry; a CommandError that says what to run when it is not set up (or, with `on`, archived). */
export function requireZone(r: TrustRecord, z: Zone, need: 'set-up' | 'on' = 'on'): ZoneEntry {
  if (isStructural(z)) throw new CommandError(`zone ${z} is always on; it is never set up, renamed or archived`)
  const e = r.zones[z]
  if (!e) throw new CommandError(`zone ${z} is not set up here: run \`trustweb zone create ${z}\``)
  if (need === 'on' && e.archivedAt !== undefined) throw new CommandError(`zone ${z} is archived: run \`trustweb zone unarchive ${z}\` first`)
  return e
}

export function requirePerson(r: TrustRecord, bare: string): PersonEntry {
  const p = r.persons[bare]
  if (!p || p.removedAt !== undefined) throw new CommandError(`person ${bare} is not in this record: run \`trustweb person add ${bare}\``)
  return p
}

export function requireTag(r: TrustRecord, bare: string): TagEntry {
  const t = r.tags[bare]
  if (!t || t.removedAt !== undefined) throw new CommandError(`tag ${bare} is not in this record: run \`trustweb tag add ${bare}\``)
  return t
}

export const liveTuples = (r: Pick<TrustRecord, 'tuples'>, now: Date): Tuple[] => r.tuples.filter((t) => isLive(t, now))

export interface Fact {
  subject: string
  relation: Relation
  object: string
}

const same = (t: Tuple, f: Fact): boolean => t.subject === f.subject && t.relation === f.relation && t.object === f.object

export const hasLive = (r: Pick<TrustRecord, 'tuples'>, f: Fact, now: Date): boolean => liveTuples(r, now).some((t) => same(t, f))

/** Appends the fact as a tuple (since now, by this device) unless the same fact is already live; says whether it did. */
export function addFact(r: TrustRecord, f: Fact, now: Date): boolean {
  if (hasLive(r, f, now)) return false
  r.tuples.push({ subject: f.subject, relation: f.relation, object: f.object, since: now.toISOString(), by: r.device })
  return true
}

/** Closes (until = now) every live tuple that `match`; returns how many. Nothing is deleted: the record keeps its history. */
export function closeFacts(r: TrustRecord, match: (t: Tuple) => boolean, now: Date): number {
  const at = now.toISOString()
  let n = 0
  r.tuples = r.tuples.map((t) => {
    if (!isLive(t, now) || !match(t)) return t
    n++
    return { ...t, until: at }
  })
  return n
}

export interface Member {
  /** `person:<id>` */
  person: string
  /** The tag rule it came through (`tag:<id>`), absent for a direct membership. */
  via?: string
}

/** Who sits in a zone right now, directly or through a tag rule, in id order; a person is listed once per way in. */
export function membersOf(r: TrustRecord, z: Zone, now: Date): Member[] {
  const seen = new Set<string>()
  const out: Member[] = []
  for (const t of storeOf(r, now)) {
    if (t.relation !== 'in_zone' || t.object !== `zone:${z}` || !t.subject.startsWith('person:') || !isLive(t, now)) continue
    const key = `${t.subject}|${t.tag ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ person: t.subject, ...(t.tag && { via: t.tag }) })
  }
  return out.sort((a, b) => a.person.localeCompare(b.person) || (a.via ?? '').localeCompare(b.via ?? ''))
}

/** The zone a person counts as (the most intimate of their live zones among the zones on; public when none). */
export const zoneOfPersonIn = (r: TrustRecord, personId: string, now: Date): Zone => personZone(storeOf(r, now), personId, now, activeZones(r)).zone

/** `ada (Ada)`, or the bare id when it has no name of its own. */
export function personLabel(r: Pick<TrustRecord, 'persons'>, personId: string): string {
  const bare = personId.replace(/^person:/, '')
  const name = r.persons[bare]?.name
  return name && name !== bare ? `${bare} (${name})` : bare
}

/** The ladder outer to inner, for listings. */
export const ladder = (): readonly Zone[] => LADDER
