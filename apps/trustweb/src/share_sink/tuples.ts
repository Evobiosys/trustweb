// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 23 (share sink): the relation store, one tuple per JSONL line, kept in the TrustWeb record (Jakob 2026-10-27, Q2/Q3).
 * Zanzibar-shaped (subject = user, relation, object) with typed ids, so an OpenFGA/SpiceDB or Solid/NextGraph adapter needs no rewrite:
 *   person:<id> has_tag tag:<id>       person:<id> in_zone zone:<Zone>
 *   person:<id> | tag:<id> | zone:<Zone>  may_read | may_write | grants  item:<id> | file:<id>
 * `zone` and `tag` are optional context, `since`/`until` bound when the tuple counts, `by` is the device that wrote it.
 */
import { type Zone, isZone } from './zones'

export const RELATIONS = ['has_tag', 'in_zone', 'may_read', 'may_write', 'grants'] as const
export type Relation = (typeof RELATIONS)[number]

export interface Tuple {
  subject: string
  relation: Relation
  object: string
  zone?: Zone
  tag?: string
  since: string
  until?: string
  by: string
}

export type Store = readonly Tuple[]

/** Planned, not in this slice: export tuples to OpenFGA / SpiceDB and delegate checks there. */
export interface ZanzibarAdapter { write(store: Store): Promise<void>; check(subject: string, relation: Relation, object: string): Promise<boolean> }
/** Planned, not in this slice: translate the store to Solid ACP / WAC resources. */
export interface SolidAdapter { toAcl(store: Store): string }
/** Planned, not in this slice: translate the store to NextGraph permissions. */
export interface NextGraphAdapter { toPermissions(store: Store): unknown }

/** A tuple counts from `since` up to (not including) `until`. */
export const isLive = (t: Tuple, now: Date): boolean => Date.parse(t.since) <= +now && (t.until === undefined || +now < Date.parse(t.until))

const str = (v: unknown): v is string => typeof v === 'string' && v !== ''

function valid(t: Record<string, unknown>): boolean {
  if (!str(t.subject) || !str(t.object) || !str(t.since) || !str(t.by)) return false
  if (!RELATIONS.includes(t.relation as Relation)) return false
  if (t.relation === 'in_zone' && !isZone(String(t.object).replace(/^zone:/, ''))) return false
  if (t.zone !== undefined && !isZone(String(t.zone))) return false
  return [t.tag, t.until].every((v) => v === undefined || str(v)) && !Number.isNaN(Date.parse(t.since))
}

/** One tuple per non-blank line; a line that is not a tuple throws with its number. */
export function parseJsonl(text: string): Tuple[] {
  const out: Tuple[] = []
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return
    let t: unknown
    try { t = JSON.parse(line) } catch { t = null }
    if (!t || typeof t !== 'object' || !valid(t as Record<string, unknown>)) throw new Error(`share sink: line ${i + 1} is not a tuple`)
    const { subject, relation, object, zone, tag, since, until, by } = t as Tuple
    out.push({ subject, relation, object, ...(zone && { zone }), ...(tag && { tag }), since, ...(until && { until }), by })
  })
  return out
}
