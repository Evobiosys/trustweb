/** Suggested rings for the Sort cards: { "<person id>": { ring, family, intending, reason } }, read from a file next to the dev record. Pure. */
import { Ring } from '../../trustweb/src/model'
import { MAX_INTENDING } from './fields'
import { UNSORTED } from './rings'
import type { RingId } from './rings'

export interface Suggestion {
  ring: RingId
  family: boolean
  /** 0 to 10 */
  intending: number
  reason: string
}

export type Suggestions = Record<string, Suggestion>

const RINGS: readonly string[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, UNSORTED]
/** The suggestion file writes "close_friend" for the ring the CRM calls close. */
const ring = (v: unknown): Suggestion['ring'] => {
  const r = v === 'close_friend' ? Ring.Close : v
  return RINGS.includes(r as string) ? (r as Suggestion['ring']) : UNSORTED
}

/** Entries that are not objects are dropped; a missing or odd field takes its neutral value. Never throws. */
export function parseSuggestions(text: string | null): Suggestions {
  if (!text) return {}
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return {} }
  if (!raw || typeof raw !== 'object') return {}
  const out: Suggestions = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue
    const s = v as Partial<Record<keyof Suggestion, unknown>>
    const intending = Math.round(Number(s.intending))
    out[id] = {
      ring: ring(s.ring),
      family: s.family === true,
      intending: intending >= 1 ? Math.min(intending, MAX_INTENDING) : 0,
      reason: typeof s.reason === 'string' ? s.reason : '',
    }
  }
  return out
}

/** Not-placed people grouped by suggested ring, in ring order; rings with nobody are left out. Pure. */
export function groupBySuggestion<T>(items: T[], idOf: (t: T) => string, suggestions: Suggestions): { ring: RingId; items: T[] }[] {
  return RINGS.map((r) => ({ ring: r as RingId, items: items.filter((t) => (suggestions[idOf(t)]?.ring ?? UNSORTED) === r) })).filter((g) => g.items.length > 0)
}
