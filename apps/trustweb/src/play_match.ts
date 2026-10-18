/**
 * Wave 16: from a play request to an ordinary ask, and the receiving phone's check against what its owner offers. Both ends are plain
 * code: a model (if any) only fills the PlayRequest shape (play_request.ts); who matches whom is decided here, deterministically.
 * Nothing new travels: the ask is text plus the usual reach (hops.ts), so I1-I3 hold unchanged. Pure and DOM-free.
 */
import { HOPS_DEFAULT } from './hops'
import { isNear } from './play_location'
import type { PlayRequest } from './play_request'

export interface PlayAsk {
  /** The ask text as it goes out (and as the receiving person reads it). */
  text: string
  /** Friend degree as ask reach (hops.ts). */
  reach: number
}

const dateLabel = (t: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t))

/** The ask for a request (after prefs filled it). `locale` is the person's, so the text reads like their own sentence. */
export function playAsk(req: PlayRequest, locale = 'en'): PlayAsk {
  const parts = [`Looking to play ${req.activity}`]
  if (req.beforeAt !== undefined) parts.push(`before ${dateLabel(req.beforeAt, locale)}`)
  if (req.area) parts.push(`near ${req.area}${req.radiusKm !== undefined ? ` (within ${req.radiusKm} km)` : ''}`)
  return { text: parts.join(' '), reach: req.reach ?? HOPS_DEFAULT }
}

/** What a person offers: a line of their own words ("I play padel in Wien 7 on weekday evenings"). */
export interface PlayOffer {
  line: string
  /** The area words the offer states, when the owner gave any. */
  area?: string
}

const has = (line: string, word: string): boolean => line.toLowerCase().includes(word.toLowerCase())

/**
 * Does this offer fit the request? The activity must appear in the line; an area is compared only when BOTH sides state one (an offer
 * without an area is open to any), by isNear() over the request's radius.
 */
export function offerFits(req: PlayRequest, offer: PlayOffer, radiusFallbackKm = 10): boolean {
  if (!has(offer.line, req.activity)) return false
  if (!req.area || !offer.area) return true
  return isNear({ label: req.area }, { label: offer.area }, req.radiusKm ?? radiusFallbackKm)
}
