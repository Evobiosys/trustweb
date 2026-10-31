// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (S2, S4, S5): a share is one line that becomes scope tuples. The preview and the enforcement both run canAccess on the
 * same store with the same tuples, so they cannot disagree (T12). Pure: no I/O, the clock is passed in.
 */
import { canAccess } from './check'
import type { Store, Tuple } from './tuples'
import type { Zone } from './zones'

const YEAR_MS = 365 * 86_400_000

/** Zone first, then inclusions and exclusions; ids are `person:<id>` or `tag:<id>`. Exclusion beats everything (D3). */
export interface Scope { zone: Zone; include: string[]; exclude: string[] }

interface Base { id: string; seq: number; ts: string }
export type ShareLine =
  | (Base & { op: 'share'; scope: Scope; cutoff: number; to: string; terms: 'read-keep' })
  | (Base & { op: 'revoke'; target: string; at: number })
  | (Base & { op: 'retract'; target: string })
  | (Base & { op: 'agree'; agreement: string; by: string; cutoff: number })

/** The tuples a scope stands for: they expire after a year by default (I9). */
export function scopeTuples(scope: Scope, itemId: string, by: string, since: Date): Tuple[] {
  const base = { since: since.toISOString(), until: new Date(+since + YEAR_MS).toISOString(), by }
  return [
    { subject: `zone:${scope.zone}`, relation: 'may_read', object: itemId, ...base },
    ...scope.include.map((s) => ({ subject: s, relation: 'may_read' as const, object: itemId, ...base })),
    ...scope.exclude.map((s) => ({ subject: s, relation: 'excludes' as const, object: itemId, ...base })),
  ]
}

/** Who would see the item under this scope: the same canAccess as enforcement, on the same store plus the scope's tuples. */
export function previewShare(store: Store, scope: Scope, people: readonly string[], itemId: string, now: Date): { count: number; names: string[] } {
  const augmented = [...store, ...scopeTuples(scope, itemId, 'preview', now)]
  const names = people.filter((id) => canAccess(augmented, id, itemId, now).allowed)
  return { count: names.length, names }
}

/** Adds a share line; its cutoff is the head seq after the line, so a one-off share never shows later lines. */
export function appendShare(lines: readonly ShareLine[], s: { id: string; scope: Scope; to: string; ts: string }): ShareLine[] {
  const seq = lines.length + 1
  return [...lines, { op: 'share', id: s.id, seq, scope: s.scope, cutoff: seq, to: s.to, terms: 'read-keep', ts: s.ts }]
}

/** A one-off share shows the lines up to its cutoff, and no later ones (a standing feed moves its cutoff instead). */
export const oneOffVisible = (share: Extract<ShareLine, { op: 'share' }>, seq: number): boolean => seq <= share.cutoff
