/**
 * Wave 6h, the asker's side of a LATE answer (ask_window.ts): "a yes that comes after the moment is delivered as a late answer: the
 * asker's app shows '<name> answered later' on their next open, up to 7 days, as one card, never as a trickle that reveals timing".
 *
 *   - Every ask this phone sends is remembered per connection (SentAsk: qid, peer, text), LATE_KEEP_MS at most.
 *   - An answer whose qid this visit no longer waits for, from the connection it was sent to, that opens to a SHARE, is kept as a
 *     LateAnswer, silently: nothing is drawn, no toast, no notification while the app is open.
 *   - On the next app open every held late answer is released at once (releaseAll) and shown together as one card. So the asker
 *     learns that a yes came after the moment and before this open, never when.
 *   - A late "nothing" is ignored (the asked phone never sends one: a no after the moment sends nothing at all).
 *   - One late answer per ask and connection: a repeat (or a peer that sends again) changes nothing.
 * Pure and DOM-free.
 */
import type { SharedItem } from '../../demo/src/types'
import { sanitizeHopItems } from './hops'
import { clipText, isRecord, keptList } from './kept_list'
import type { KeepRule } from './kept_list'
import type { LateAnswer, SentAsk } from './model'

/** A late yes counts up to this long after the ask, and is shown up to this long after it arrived. */
export const LATE_KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** Remembered asks: enough for a busy week (each ask is one entry per connection). */
export const SENT_ASKS_MAX = 400
/** Kept late answers. */
export const LATE_ANSWERS_MAX = 20
/** The asked text kept with them (an ask is at most FREE_TEXT_MAX_LEN on the wire anyway). */
export const LATE_TEXT_MAX = 300

const isSent = (v: unknown): v is SentAsk =>
  isRecord(v) && typeof v.qid === 'string' && typeof v.peerId === 'string' && typeof v.text === 'string' && typeof v.at === 'number'

const isLate = (v: unknown): v is LateAnswer =>
  isRecord(v) && typeof v.id === 'string' && typeof v.at === 'number' && typeof v.peerId === 'string' && typeof v.from === 'string'
  && typeof v.ask === 'string' && Array.isArray(v.items) && (v.releasedAt === undefined || typeof v.releasedAt === 'number')

const SENT_RULE: KeepRule<SentAsk> = { is: isSent, keepMs: LATE_KEEP_MS, max: SENT_ASKS_MAX }
const LATE_RULE: KeepRule<LateAnswer> = { is: isLate, keepMs: LATE_KEEP_MS, max: LATE_ANSWERS_MAX }

export function liveSentAsks(list: unknown, now: number): SentAsk[] {
  return keptList(list, SENT_RULE, now)
}

/** Remembers the asks just sent (one per connection). A qid already held is not added twice. */
export function addSentAsks(list: unknown, asks: readonly SentAsk[], now: number): SentAsk[] {
  const live = liveSentAsks(list, now)
  const held = new Set(live.map((a) => a.qid))
  const fresh = asks.filter((a) => !held.has(a.qid)).map((a) => ({ ...a, text: clipText(a.text, LATE_TEXT_MAX) }))
  return liveSentAsks([...fresh, ...live], now)
}

/** The remembered ask an answer belongs to: the same qid AND the connection it was sent to (anyone else's answer is not one). */
export function sentAskFor(list: unknown, qid: string, peerId: string, now: number): SentAsk | undefined {
  return liveSentAsks(list, now).find((a) => a.qid === qid && a.peerId === peerId)
}

/** Forgets one remembered ask (its late answer arrived). */
export function forgetSentAsk(list: unknown, qid: string, now: number): SentAsk[] {
  return liveSentAsks(list, now).filter((a) => a.qid !== qid)
}

export function liveLateAnswers(list: unknown, now: number): LateAnswer[] {
  return keptList(list, LATE_RULE, now).map((a) => ({ ...a, items: sanitizeHopItems(a.items) }))
}

/** A late yes, as it arrived: held (not released) until the next app open. A second one for the same ask changes nothing. */
export function addLateAnswer(list: unknown, sent: SentAsk, from: string, items: readonly SharedItem[], now: number): LateAnswer[] {
  const live = liveLateAnswers(list, now)
  if (live.some((a) => a.id === sent.qid)) return live
  const late: LateAnswer = { id: sent.qid, at: now, peerId: sent.peerId, from, ask: sent.text, items: sanitizeHopItems(items) }
  return liveLateAnswers([late, ...live], now)
}

/** The app opened: every held late answer is released now, all at once. */
export function releaseLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).map((a) => (a.releasedAt === undefined ? { ...a, releasedAt: now } : a))
}

/** The late answers to show: released ones only (a held one waits for the next open, whenever it arrived). */
export function shownLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).filter((a) => a.releasedAt !== undefined)
}

/** Dismisses every shown one (the card shows them together). Held ones stay for the next open. */
export function dismissShownLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).filter((a) => a.releasedAt === undefined)
}
