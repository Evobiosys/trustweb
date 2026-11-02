// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The one place the CLI meets the app's sharing code (apps/trustweb/src/share_sink, D-share-sink): everything the
 * commands need from it is re-exported here, so no command imports the app directly, and the few derived views the
 * CLI adds on top (which zones are on, the relation store with the share lines and the tag rules folded in) sit next
 * to the functions they feed. The rules of who sees what stay the app's: `canAccess` is the only oracle.
 */
import type { TrustRecord } from './record.ts'
import { heldTags } from '../../../apps/trustweb/src/share_sink/check.ts'
import { type Store, type Tuple, isLive } from '../../../apps/trustweb/src/share_sink/tuples.ts'
import type { ShareLine } from '../../../apps/trustweb/src/share_sink/share_lines.ts'
import { scopeTuples } from '../../../apps/trustweb/src/share_sink/share_lines.ts'
import { Zone, LADDER } from '../../../apps/trustweb/src/share_sink/zones.ts'

export { Zone, LADDER, ALL_ZONES, rank, isZone, mostIntimate, effectiveZone } from '../../../apps/trustweb/src/share_sink/zones.ts'
export { RELATIONS, isLive, parseJsonl, type Relation, type Store, type Tuple } from '../../../apps/trustweb/src/share_sink/tuples.ts'
export { canAccess, personZone, heldTags, opens, type Access } from '../../../apps/trustweb/src/share_sink/check.ts'
export { toJsonl, toMarkdown } from '../../../apps/trustweb/src/share_sink/export.ts'
export { nest, ancestors, depthOf, MAX_DEPTH } from '../../../apps/trustweb/src/share_sink/tags.ts'
export { scopeTuples, previewShare, appendShare, oneOffVisible, type Scope, type ShareLine } from '../../../apps/trustweb/src/share_sink/share_lines.ts'

export type ShareOp = Extract<ShareLine, { op: 'share' }>

/** The zones that count for `canAccess`: public and self always (zones.ts), plus every zone set up here and not archived. */
export function activeZones(r: Pick<TrustRecord, 'zones'>): Zone[] {
  return LADDER.filter((z) => z === Zone.Public || z === Zone.Self || (r.zones[z] !== undefined && r.zones[z].archivedAt === undefined))
}

/** Every person the record knows: declared ones and anyone a tuple names as a subject. */
export function personIds(r: Pick<TrustRecord, 'persons' | 'tuples'>): string[] {
  const ids = new Set(Object.keys(r.persons).map((p) => `person:${p}`))
  for (const t of r.tuples) if (t.subject.startsWith('person:')) ids.add(t.subject)
  return [...ids].sort()
}

/** The latest share line per item wins, as on the app's Share page (share_page.ts storeOf); a later revoke of the item ends it. */
export function latestShares(shares: readonly ShareLine[]): ShareOp[] {
  const latest = new Map<string, ShareOp>()
  for (const l of shares) {
    if (l.op === 'share') latest.set(l.id, l)
    else if (l.op === 'revoke') latest.delete(l.target)
  }
  return [...latest.values()]
}

/**
 * A tag rule `tag:<t> in_zone zone:<z>` (zone add-tag) puts every live carrier of the tag, and of the tags nested under it,
 * in that zone. The ladder check reads a person's own `in_zone` tuples only, so the rule is unfolded into one derived
 * tuple per carrier, marked with the tag it came through (`tag`) and the rule's writer (`by`).
 */
export function unfoldTagRules(tuples: Store, persons: readonly string[], now: Date): Tuple[] {
  const live = tuples.filter((t) => isLive(t, now))
  const rules = live.filter((t) => t.relation === 'in_zone' && t.subject.startsWith('tag:'))
  if (!rules.length) return []
  const out: Tuple[] = []
  for (const p of persons) {
    const held = heldTags(live, p)
    for (const rule of rules) {
      if (!held.has(rule.subject)) continue
      out.push({ subject: p, relation: 'in_zone', object: rule.object, tag: rule.subject, since: rule.since, ...(rule.until && { until: rule.until }), by: rule.by })
    }
  }
  return out
}

/** Is this `person:`/`tag:` id removed in the record? (Anything else, a zone say, is not.) */
export function isRemoved(r: Pick<TrustRecord, 'persons' | 'tags'>, id: string): boolean {
  const bare = id.slice(id.indexOf(':') + 1)
  const entry = id.startsWith('person:') ? r.persons[bare] : id.startsWith('tag:') ? r.tags[bare] : undefined
  return entry?.removedAt !== undefined
}

/**
 * The store every check runs on: the record's tuples, the tag rules unfolded, and the scope tuples of the latest shares.
 * A share's `--also` of a person or tag removed since gives nothing any more (removal ends their grants, the record says);
 * its `--except` keeps standing (an exclusion is the conservative side, I9).
 */
export function storeOf(r: Pick<TrustRecord, 'tuples' | 'shares' | 'persons' | 'tags' | 'device'>, now: Date): Store {
  const derived = unfoldTagRules(r.tuples, personIds(r), now)
  const scopes = latestShares(r.shares).flatMap((l) =>
    scopeTuples({ ...l.scope, include: l.scope.include.filter((id) => !isRemoved(r, id)) }, l.id, r.device, new Date(l.ts)))
  return [...r.tuples, ...derived, ...scopes]
}

/** The live tuples among `tuples` that `match`, closed at `now` (until = now); the rest untouched. Nothing is ever deleted. */
export function closeTuples(tuples: Store, match: (t: Tuple) => boolean, now: Date): { tuples: Tuple[]; closed: number } {
  let closed = 0
  const at = now.toISOString()
  const next = tuples.map((t) => {
    if (!isLive(t, now) || !match(t)) return t
    closed++
    return { ...t, until: at }
  })
  return { tuples: next, closed }
}
