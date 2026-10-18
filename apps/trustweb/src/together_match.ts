/**
 * Wave 16: from a play request to an ordinary ask, and the receiving phone's check against what its owner offers. Both ends are plain
 * code: a model (if any) only fills the TogetherRequest shape (together_request.ts); who matches whom is decided here, deterministically.
 * Nothing new travels: the ask is text plus the usual reach (hops.ts), so I1-I3 hold unchanged. Pure and DOM-free.
 */
import { HOPS_DEFAULT } from './hops'
import { isNear } from './together_location'
import type { TogetherRequest } from './together_request'

export interface TogetherAsk {
  /** The ask text as it goes out (and as the receiving person reads it). */
  text: string
  /** Friend degree as ask reach (hops.ts). */
  reach: number
}

const dateLabel = (t: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t))

/** One day -> "on Fri, Oct 23"; a span -> "from X to Y" (last day included); only a deadline -> "before X" (that midnight excluded). */
function windowWords(req: TogetherRequest, locale: string): string[] {
  const { fromAt, beforeAt } = req
  if (beforeAt === undefined) return []
  if (fromAt === undefined) return [`before ${dateLabel(beforeAt, locale)}`]
  const last = new Date(beforeAt); last.setDate(last.getDate() - 1)
  const first = dateLabel(fromAt, locale), end = dateLabel(last.getTime(), locale)
  return [first === end ? `on ${first}` : `from ${first} to ${end}`]
}

/** The ask for a request (after prefs filled it). `locale` is the person's, so the text reads like their own sentence. */
export function togetherAsk(req: TogetherRequest, locale = 'en'): TogetherAsk {
  const parts = [`Looking for company: ${req.phrase ?? req.activity}`]
  parts.push(...windowWords(req, locale))
  if (req.area) parts.push(`near ${req.area}${req.radiusKm !== undefined ? ` (within ${req.radiusKm} km)` : ''}`)
  return { text: parts.join(' '), reach: req.reach ?? HOPS_DEFAULT }
}

/** What a person offers: a line of their own words ("I play padel in Wien 7 on weekday evenings"). */
export interface TogetherOffer {
  line: string
  /** The area words the offer states, when the owner gave any. */
  area?: string
}

/** Whole-word match, so "cook" does not fit "cookie" (a trailing -s/-ing/-en of the same word does). */
const has = (line: string, word: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es|ing|en)?(?![\\p{L}\\p{N}])`, 'iu').test(line)

/**
 * Does this offer fit the request? The activity must appear in the line; an area is compared only when BOTH sides state one (an offer
 * without an area is open to any), by isNear() over the request's radius.
 */
export function offerFits(req: TogetherRequest, offer: TogetherOffer, radiusFallbackKm = 10): boolean {
  if (!has(offer.line, req.activity)) return false
  if (!req.area || !offer.area) return true
  return isNear({ label: req.area }, { label: offer.area }, req.radiusKm ?? radiusFallbackKm)
}
