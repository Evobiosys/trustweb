/** Merging two people: which field values the survivor takes, and which records move over. Pure. */
import { NOTES_KEY, isSet, valueText } from './fields'
import { LAST_NAME_KEY } from './placement'
import { RING_KEY } from './rings'
import type { FieldValue, FieldValues } from './fields'
import type { KeepInTouch, ContactPoint, FollowUp, Interaction } from './model'

export enum Pick {
  Keep = 'keep',
  Other = 'other',
  /** Both values, joined. */
  Both = 'both',
  /** Neither value: the field ends up empty. */
  Neither = 'neither',
  /** A value typed in the sheet (a name both sides spell wrong, a phone number that changed): not either side's. */
  Custom = 'custom',
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

/** Both values in one: " · " between them, a new line for notes. */
function joined(key: string, a: FieldValue | undefined, b: FieldValue | undefined): FieldValue {
  return [valueText(a), valueText(b)].filter(Boolean).join(key === NOTES_KEY ? '\n' : ' · ')
}

/** The pick after tapping × on one side: that side's value drops out. */
export function dismiss(pick: Pick, side: Pick.Keep | Pick.Other): Pick {
  const other = side === Pick.Keep ? Pick.Other : Pick.Keep
  return pick === side || pick === Pick.Neither ? Pick.Neither : pick === Pick.Both ? other : pick
}

/** The value a row ends with under `pick`. */
function resultOf(r: MergeRow, pick: Pick, custom: Readonly<Record<string, string>>): FieldValue | undefined {
  return pick === Pick.Keep ? r.keep : pick === Pick.Other ? r.other : pick === Pick.Both ? joined(r.key, r.keep, r.other) : pick === Pick.Custom ? customText(custom, r.key) : undefined
}

/** The typed value of `key`, trimmed; '' when nothing was typed (the survivor then keeps what it has). */
export const customText = (custom: Readonly<Record<string, string>>, key: string): string => (custom[key] ?? '').trim()

/** Whether a value may be typed for `key`: any field but the ring (its values are the rings, not text). */
export const customAllowed = (key: string): boolean => key !== RING_KEY

const NAME_KEYS: readonly string[] = ['tw-first', LAST_NAME_KEY]

/** Whether "Neither" may be picked for `key`: never for the ring, and for a name part only while the other part keeps a value. `same` holds the values both people share. */
export function neitherAllowed(key: string, rows: readonly MergeRow[], picks: Readonly<Record<string, Pick>>, same: FieldValues, custom: Readonly<Record<string, string>> = {}): boolean {
  if (key === RING_KEY) return false
  if (!NAME_KEYS.includes(key)) return true
  const otherKey = NAME_KEYS.find((k) => k !== key) as string
  const row = rows.find((r) => r.key === otherKey)
  return isSet(row ? resultOf(row, picks[otherKey] ?? row.pick, custom) : same[otherKey])
}

/** How many fields the merge empties. */
export function clearedCount(rows: readonly MergeRow[], picks: Readonly<Record<string, Pick>>): number {
  return rows.filter((r) => (picks[r.key] ?? r.pick) === Pick.Neither).length
}

/** The field edits that put the survivor's merged values in place (nothing for a kept value). */
export function mergeEdits(rows: readonly MergeRow[], picks: Readonly<Record<string, Pick>>, custom: Readonly<Record<string, string>> = {}): [string, FieldValue][] {
  const edits: [string, FieldValue][] = []
  for (const r of rows) {
    const pick = picks[r.key] ?? r.pick
    if (pick === Pick.Other && r.other !== undefined) edits.push([r.key, r.other])
    else if (pick === Pick.Both) edits.push([r.key, joined(r.key, r.keep, r.other)])
    else if (pick === Pick.Neither) edits.push([r.key, ''])
    else if (pick === Pick.Custom && customAllowed(r.key) && customText(custom, r.key)) edits.push([r.key, customText(custom, r.key)])
  }
  return edits
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

/** Moves the keep-in-touch entry of `from` to the survivor when it has none; returns the entry moved (for an undo). */
export function moveKeepInTouch(kit: Record<string, KeepInTouch> | undefined, from: string, into: string): KeepInTouch | undefined {
  const moved = kit?.[from]
  if (!kit || !moved || kit[into]) return undefined
  kit[into] = moved
  delete kit[from]
  return moved
}
