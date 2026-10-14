/**
 * The rings as the CRM shows them: four greens (darkest = closest), family in purple with a closeness of its own, unsorted in grey.
 * RING_COLORS is plain data on purpose: the outliner branch copies it as is.
 */
import { Ring } from '../../trustweb/src/model'
import { FAMOUS_KEY, INTENDING_KEY } from './fields'
import type { FieldValue, FieldValues } from './fields'

export const FAMILY = 'family'
export const UNSORTED = 'unsorted'
export const FAMILY_KEY = 'LNlpliq4GdNI'
export const CLOSENESS_KEY = 'tw-closeness'
/** A choice that files a person under famous (filtered out of the web); it is no ring. */
export const OUT_OF_WEB = 'outofweb'

export type RingId = Ring | typeof FAMILY | typeof UNSORTED
export type Choice = RingId | typeof OUT_OF_WEB

// ring -> colour; family keeps the same four steps in purple, keyed by its closeness.
export const RING_COLORS = {
  close: '#1b5e20', friend: '#2e7d32', acquaintance: '#66bb6a', intending: '#a5d6a7',
  family: { close: '#4a148c', friend: '#7b1fa2', acquaintance: '#ab47bc', intending: '#ce93d8' },
  unsorted: '#9e9e9e',
}

/** Display order of the groups and chips. */
export const RING_ORDER: readonly RingId[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, FAMILY, UNSORTED]
export const CHOICES: readonly Choice[] = [...RING_ORDER, OUT_OF_WEB]

/** The ring a person is filed under: anything unknown (an older "none") counts as unsorted. */
export function ringOf(ring: string | undefined): RingId {
  return (RING_ORDER as readonly string[]).includes(ring ?? '') ? (ring as RingId) : UNSORTED
}

export function ringColor(ring: string | undefined, values: FieldValues = {}): string {
  const r = ringOf(ring)
  if (r !== FAMILY) return RING_COLORS[r]
  const c = values[CLOSENESS_KEY] as keyof typeof RING_COLORS.family
  return RING_COLORS.family[c] ?? RING_COLORS.family.close
}

/** The field edits that file a person under `choice`; the family / intending / famous checkboxes follow it (those two first sync to Tana). */
export function choiceEdits(choice: Choice, current: FieldValues): [string, FieldValue][] {
  const edits: [string, FieldValue][] = [['tw-ring', choice === OUT_OF_WEB ? UNSORTED : choice]]
  const box = (key: string, on: boolean): void => {
    if ((current[key] === true) !== on) edits.push([key, on])
  }
  box(FAMILY_KEY, choice === FAMILY)
  box(INTENDING_KEY, choice === Ring.Intending)
  box(FAMOUS_KEY, choice === OUT_OF_WEB)
  if (choice === FAMILY && !current[CLOSENESS_KEY]) edits.push([CLOSENESS_KEY, Ring.Close])
  return edits
}
