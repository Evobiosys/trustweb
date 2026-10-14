/** Merging two people: which field values the survivor takes, and which records move over. Pure. */
import { isSet, valueText } from './fields'
import type { FieldValue, FieldValues } from './fields'
import type { ContactPoint, FollowUp, Interaction } from './model'

export enum Pick {
  Keep = 'keep',
  Other = 'other',
}

export interface MergeRow {
  key: string
  keep: FieldValue | undefined
  other: FieldValue | undefined
  /** The default: the non-empty value, the newer person's on conflict. */
  pick: Pick
}

/** One row per field where the two differ and at least one is set. */
export function mergeRows(keep: FieldValues, other: FieldValues, otherIsNewer: boolean): MergeRow[] {
  return [...new Set([...Object.keys(keep), ...Object.keys(other)])]
    .filter((key) => (isSet(keep[key]) || isSet(other[key])) && valueText(keep[key]) !== valueText(other[key]))
    .map((key) => ({
      key, keep: keep[key], other: other[key],
      pick: !isSet(other[key]) ? Pick.Keep : !isSet(keep[key]) ? Pick.Other : otherIsNewer ? Pick.Other : Pick.Keep,
    }))
}

/** The field edits that put the other person's picked values on the survivor. */
export function mergeEdits(rows: readonly MergeRow[], picks: Readonly<Record<string, Pick>>): [string, FieldValue][] {
  return rows.filter((r) => (picks[r.key] ?? r.pick) === Pick.Other && r.other !== undefined).map((r) => [r.key, r.other as FieldValue])
}

/** Interactions and follow-ups of `from` re-pointed at `into`; the ids moved (for an undo). */
export function repoint<T extends Interaction | FollowUp>(list: T[], from: string, into: string): string[] {
  const moved: string[] = []
  for (const x of list) if (x.personId === from) { x.personId = into; moved.push(x.id) }
  return moved
}

/** Contact points of both, without a kind + value twice. */
export function joinPoints(a: readonly ContactPoint[] = [], b: readonly ContactPoint[] = []): ContactPoint[] {
  const seen = new Set<string>()
  return [...a, ...b].filter((p) => { const k = `${p.kind}|${p.value}`; return !seen.has(k) && seen.add(k) })
}

/** The lines of `other` the survivor does not carry yet (same text and tag counts as carried); the ring markers stay behind. */
export function linesToAdd<L extends { text: string; tag: string }>(keep: readonly L[], other: readonly L[]): L[] {
  const have = new Set(keep.map((l) => `${l.tag}|${l.text}`))
  return other.filter((l) => !l.text.startsWith('ring: ') && !have.has(`${l.tag}|${l.text}`))
}
