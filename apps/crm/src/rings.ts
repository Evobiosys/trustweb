/**
 * The rings as the CRM shows them, centre outwards: close friend, friend, acquaintance, intending to connect. UNSORTED is no ring:
 * it marks people not placed yet, who sit outside the rings.
 * Family is no ring but a tag (checkbox) on top of any closeness. RING_COLORS is plain data on purpose: the outliner branch copies it as is.
 */
import { Ring } from '../../trustweb/src/model'
import { DESIRE_DEFAULT } from '../../trustweb/src/rings_layout'
import { FAMOUS_KEY, INTENDING_KEY, MAX_INTENDING, SINCE_KEY, intendingOf } from './fields'
import type { FieldValue, FieldValues } from './fields'

export const UNSORTED = 'unsorted'
export const FAMILY_KEY = 'LNlpliq4GdNI'
/** This app's model also has None (not in my web) and Family (a tag here); neither is a ring the Curator files under. */
export type RingId = Exclude<Ring, Ring.None | Ring.Family> | typeof UNSORTED

/** Tana's "ring" options field and its "ring approved" checkbox (the ring sync writes both), with the option id per ring. */
export const RING_KEY = 'tw-ring'
export const RING_FIELD = 'rVfw62lb7BYD'
export const RING_APPROVED_KEY = '_7wgarGd90ZR'
export const TANA_RING_OPTIONS: Record<RingId, string> = {
  close: 'ODC_KVcWiMTS', friend: 'L3O_fhbzNg3H', acquaintance: '5g0_ijoSfbqA', intending: 'RK_7xKgGfWYB', unsorted: 'THYXz_h9_MSf',
}
/** A choice that files a person under famous (filtered out of the web); it is no ring. */
export const OUT_OF_WEB = 'outofweb'

/** What the ring chips offer: the four rings, or out of my web. */
export type Choice = Exclude<RingId, typeof UNSORTED> | typeof OUT_OF_WEB

export const RING_COLORS = {
  close: '#8C4A00', friend: '#B8700A', acquaintance: '#D99A2B', intending: '#EFC978',
  unsorted: '#9e9e9e',
  /** The family tag's accent dot / chip. */
  family: '#7b1fa2',
}

/** Display order of the groups, from the centre. */
export const RING_ORDER: readonly Exclude<RingId, typeof UNSORTED>[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]
export const CHOICES: readonly Choice[] = [...RING_ORDER, OUT_OF_WEB]

/** The ring a person is filed under: anything unknown (an older "none" or "family") counts as unsorted. */
export function ringOf(ring: string | undefined): RingId {
  return (RING_ORDER as readonly string[]).includes(ring ?? '') ? (ring as RingId) : UNSORTED
}

export function ringColor(ring: string | undefined): string {
  return RING_COLORS[ringOf(ring)]
}

/** Intending to connect = a desire of 1 or more and no closer ring; otherwise the ring stays. */
export function ringWithIntending(ring: string | undefined, values: FieldValues): RingId {
  const r = ringOf(ring)
  return r === UNSORTED || r === Ring.Intending ? (intendingOf(values) >= 1 ? Ring.Intending : UNSORTED) : r
}

/** The field edits that file a person under `choice`; the famous checkbox follows it. Intending to connect starts at the default desire when none is set. */
export function choiceEdits(choice: Choice, current: FieldValues, today = ''): [string, FieldValue][] {
  const ring = choice === OUT_OF_WEB ? ringWithIntending(UNSORTED, current) : choice
  const edits: [string, FieldValue][] = choice === Ring.Intending && intendingOf(current) === 0
    ? [[INTENDING_KEY, String(DESIRE_DEFAULT)], [SINCE_KEY, today], ['tw-ring', ring]]
    : [['tw-ring', ring]]
  if ((current[FAMOUS_KEY] === true) !== (choice === OUT_OF_WEB)) edits.push([FAMOUS_KEY, choice === OUT_OF_WEB])
  return edits
}

/** The edits for a new desire `n` (0 to 10): the number, the date it changed (today), and the ring when no closer one holds. */
export function intendingEdits(n: number, current: FieldValues, today: string): [string, FieldValue][] {
  const value = Math.max(0, Math.min(MAX_INTENDING, Math.round(n)))
  if (value === intendingOf(current)) return []
  const next = { ...current, [INTENDING_KEY]: String(value) }
  const edits: [string, FieldValue][] = [[INTENDING_KEY, String(value)], [SINCE_KEY, today]]
  const ring = ringWithIntending(current['tw-ring'] as string | undefined, next)
  if (ring !== ringOf(current['tw-ring'] as string | undefined)) edits.push(['tw-ring', ring])
  return edits
}
