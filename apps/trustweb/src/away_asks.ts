/**
 * Wave 6f, F3: "they should be able to query my web in real time". With this phone online an ask reaches it at once and is answered at
 * its fixed moment (net.ts, unchanged). With this phone closed the relay holds the ask until it opens again; by then its asker stopped
 * waiting long ago (they saw the honest "no answer" at their fixed moment). Before this module such an ask still popped up a consent
 * prompt for an asker who was gone, and the answer went nowhere.
 *
 * Now an ask that arrives later than its asker could still be waiting is AWAY: it gets no prompt and no answer (nothing leaves this
 * phone, so the fixed moment the asker saw stays the only one), it is never passed on, it is logged, and when it matched this web it is
 * kept as "<name> asked while you were away" so the person can write to them. A non-matching ask stays as silent as it is live
 * (the surface-or-stay-silent rule of incoming_query.ts).
 *
 * "Later than its asker could be waiting": the ask's own issuedAt (the asker's clock) plus the longest an asker waits for that reach
 * (hops.ts askTimeoutMs) plus a generous margin for clocks that disagree. A phone whose clock runs behind by less than the margin is
 * never mistaken for away; one that runs ahead only ever makes an ask look live (the behaviour before this module).
 *
 * Pure and DOM-free.
 */
import type { AwayAsk } from './model'

/** Clocks of two phones may disagree by this much before a live ask could be mistaken for an away one. */
export const AWAY_MARGIN_MS = 10 * 60 * 1000
/** Kept at most this many, newest first. */
export const AWAY_ASKS_MAX = 20
/** Kept at most this long (or until dismissed). */
export const AWAY_ASK_KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** The asked text is kept at most this long (an ask is at most FREE_TEXT_MAX_LEN on the wire already). */
export const AWAY_TEXT_MAX = 300

/** Did this ask reach this phone after its asker stopped waiting? `issuedAt` not a number (a malformed envelope): treated as live. */
export function isAwayAsk(issuedAt: unknown, receivedAt: number, askerWaitsMs: number): boolean {
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return false
  return receivedAt - issuedAt > askerWaitsMs + AWAY_MARGIN_MS
}

const isAway = (v: unknown): v is AwayAsk => {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return typeof a.id === 'string' && typeof a.at === 'number' && typeof a.peerId === 'string' && typeof a.from === 'string' && typeof a.text === 'string'
}

/** The kept list, cleaned: well-formed entries only, none older than the keep time, newest first, bounded. Never throws. */
export function liveAwayAsks(list: unknown, now: number): AwayAsk[] {
  if (!Array.isArray(list)) return []
  return list.filter(isAway).filter((a) => now - a.at <= AWAY_ASK_KEEP_MS).sort((a, b) => b.at - a.at).slice(0, AWAY_ASKS_MAX)
}

/** Adds one (a redelivery of the same ask id changes nothing). Returns the new list. */
export function addAwayAsk(list: unknown, ask: AwayAsk, now: number): AwayAsk[] {
  const live = liveAwayAsks(list, now)
  if (live.some((a) => a.id === ask.id)) return live
  const text = [...ask.text].slice(0, AWAY_TEXT_MAX).join('')
  return liveAwayAsks([{ ...ask, text }, ...live], now)
}

/** Removes one by id. Returns the new list. */
export function dismissAwayAsk(list: unknown, id: string, now: number): AwayAsk[] {
  return liveAwayAsks(list, now).filter((a) => a.id !== id)
}
