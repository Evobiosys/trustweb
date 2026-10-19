/**
 * Wave 16: from a together request to an ordinary ask; the receiving phone answers it with the usual matcher (net.ts matchAsk).
 * Nothing new travels: the ask is text plus the usual reach (hops.ts), so I1-I3 hold unchanged. Pure and DOM-free.
 */
import { HOPS_DEFAULT } from './hops'
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
