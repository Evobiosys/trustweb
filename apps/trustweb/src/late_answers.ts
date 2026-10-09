/**
 * Wave 6h, the asker's side of a LATE answer (ask_window.ts): "a yes that comes after the moment is delivered as a late answer: the
 * asker's app shows '<name> answered later' on their next open, up to 7 days, as one card, never as a trickle that reveals timing".
 *
 *   - Every ask this phone sends is remembered once, with the qid it carried to each connection (SentAsk), LATE_KEEP_MS at most.
 *   - An answer whose qid this visit no longer waits for, from the connection it was sent to, that opens to a SHARE, is kept as a
 *     LateAnswer, silently: nothing is drawn, no toast, no notification while the app is open.
 *   - On the next app open every held late answer is released at once (releaseLateAnswers) and shown together as one card. So the
 *     asker learns that a yes came after the moment and before this open, never when. Review 6h: an open is a start of the app or
 *     its return to the front after a long time away, and what the relay hands over right after it (OPEN_DRAIN_GRACE_MS from the
 *     first connect of that open: the yeses that waited on the relay while the app was closed) belongs to that open too; before,
 *     those were held for the open after, so a phone that is closed between asks saw its late answer one open late.
 *   - A late "nothing" is ignored (the asked phone never sends one: a no after the moment sends nothing at all).
 *   - One late answer per ask and connection: a repeat (or a peer that sends again) changes nothing.
 * Wave 6i: the remembered asks are also the asker's log for re-asks (reask.ts): kept SENT_ASK_KEEP_MS (the 30 days a re-ask reaches back
 * plus the 7 days its late yes may take), while a late yes still counts only LATE_KEEP_MS after the ask (or its re-ask) went out.
 * Pure and DOM-free.
 */
import type { SharedItem } from '../../demo/src/types'
import { sanitizeHopItems } from './hops'
import { clipText, isRecord, keptList } from './kept_list'
import type { KeepRule } from './kept_list'
import type { LateAnswer, SentAsk, SentAskTo, SentTo } from './model'

/** A late yes counts up to this long after the ask, and is shown up to this long after it arrived. */
export const LATE_KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** Wave 6i: a remembered ask is kept this long: the 30 days a re-ask reaches back (reask.ts REASK_WINDOW_MS) plus LATE_KEEP_MS. */
export const SENT_ASK_KEEP_MS = 37 * 24 * 60 * 60 * 1000
/** Remembered asks: enough for a busy month (one entry per ask, whatever the number of connections). */
export const SENT_ASKS_MAX = 200
/** Connections remembered per ask (a web larger than this keeps the first ones). */
export const SENT_TO_MAX = 1000
/** Kept late answers. */
export const LATE_ANSWERS_MAX = 20
/** The asked text kept with them (an ask is at most FREE_TEXT_MAX_LEN on the wire anyway). */
export const LATE_TEXT_MAX = 300

/**
 * The app was opened at `openedAt` and its drain connected at `connectedAt`: until when do late answers count as part of this open?
 * A connect long after the open (offline for a while) opens no such window: what it brings is held for the next open.
 */
export const OPEN_DRAIN_GRACE_MS = 15_000
export const OPEN_CONNECT_MAX_MS = 60_000

export function openWindowUntil(openedAt: number, connectedAt: number): number {
  const gap = connectedAt - openedAt
  return gap >= 0 && gap <= OPEN_CONNECT_MAX_MS ? connectedAt + OPEN_DRAIN_GRACE_MS : 0
}

const optNumber = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v))

const isSentTo = (v: unknown): v is SentTo =>
  isRecord(v) && typeof v.peerId === 'string' && typeof v.qid === 'string'
  && optNumber(v.at) && (v.reaskOf === undefined || typeof v.reaskOf === 'string') && optNumber(v.reasks)

const isSent = (v: unknown): v is SentAsk =>
  isRecord(v) && typeof v.id === 'string' && typeof v.text === 'string' && typeof v.at === 'number'
  && Array.isArray(v.to) && v.to.length <= SENT_TO_MAX && v.to.every(isSentTo)

const isLate = (v: unknown): v is LateAnswer =>
  isRecord(v) && typeof v.id === 'string' && typeof v.at === 'number' && typeof v.peerId === 'string' && typeof v.from === 'string'
  && typeof v.ask === 'string' && Array.isArray(v.items) && (v.releasedAt === undefined || typeof v.releasedAt === 'number')
  && optNumber(v.askedAt) && (v.earlier === undefined || typeof v.earlier === 'boolean')

const SENT_RULE: KeepRule<SentAsk> = { is: isSent, keepMs: SENT_ASK_KEEP_MS, max: SENT_ASKS_MAX }
const LATE_RULE: KeepRule<LateAnswer> = { is: isLate, keepMs: LATE_KEEP_MS, max: LATE_ANSWERS_MAX }

export function liveSentAsks(list: unknown, now: number): SentAsk[] {
  return keptList(list, SENT_RULE, now)
}

/** Remembers the ask just sent. An id already held is not added twice; an ask that went to nobody is not kept. */
export function addSentAsk(list: unknown, ask: SentAsk, now: number): SentAsk[] {
  const live = liveSentAsks(list, now)
  if (!ask.to.length || live.some((a) => a.id === ask.id)) return live
  return liveSentAsks([{ ...ask, text: clipText(ask.text, LATE_TEXT_MAX), to: ask.to.slice(0, SENT_TO_MAX) }, ...live], now)
}

/** When the ask went to this connection last: its re-ask, or the ask itself. */
function sentAt(a: SentAsk, to: SentTo): number {
  return to.at ?? a.at
}

/** The remembered ask and connection of a qid, whatever its age (within the keep time). */
function findSent(list: unknown, qid: string, peerId: string, now: number): { ask: SentAsk; to: SentTo } | undefined {
  for (const a of liveSentAsks(list, now)) {
    const to = a.to.find((x) => x.qid === qid && x.peerId === peerId)
    if (to) return { ask: a, to }
  }
  return undefined
}

/**
 * The remembered ask an answer belongs to: the same qid AND the connection it was sent to (anyone else's answer is not one), sent there
 * at most LATE_KEEP_MS ago (wave 6i: the list itself is kept longer, for re-asks).
 */
export function sentAskFor(list: unknown, qid: string, peerId: string, now: number): SentAskTo | undefined {
  const hit = findSent(list, qid, peerId, now)
  if (!hit || now - sentAt(hit.ask, hit.to) > LATE_KEEP_MS) return undefined
  return { qid: hit.to.qid, peerId: hit.to.peerId, text: hit.ask.text, at: hit.ask.at, ...(hit.to.reaskOf !== undefined ? { earlier: true } : {}) }
}

/** Wave 6i (chat_re.ts): the words and time of this phone's own ask behind a qid one connection got, for a reply that quotes it. */
export function askOfQid(list: unknown, qid: string, peerId: string, now: number): { text: string; at: number } | undefined {
  const hit = findSent(list, qid, peerId, now)
  return hit ? { text: hit.ask.text, at: hit.ask.at } : undefined
}

/** Forgets one connection's qid (its late answer arrived, or it shared at the moment); an ask nobody can still answer goes. */
export function forgetSentAsk(list: unknown, qid: string, now: number): SentAsk[] {
  return liveSentAsks(list, now)
    .map((a) => ({ ...a, to: a.to.filter((x) => x.qid !== qid) }))
    .filter((a) => a.to.length > 0)
}

export function liveLateAnswers(list: unknown, now: number): LateAnswer[] {
  return keptList(list, LATE_RULE, now).map((a) => ({ ...a, items: sanitizeHopItems(a.items) }))
}

/** A late yes, as it arrived: held (not released) until the next app open. A second one for the same ask changes nothing. */
export function addLateAnswer(list: unknown, sent: SentAskTo, from: string, items: readonly SharedItem[], now: number): LateAnswer[] {
  const live = liveLateAnswers(list, now)
  if (live.some((a) => a.id === sent.qid)) return live
  const late: LateAnswer = {
    id: sent.qid, at: now, peerId: sent.peerId, from, ask: sent.text, items: sanitizeHopItems(items), askedAt: sent.at,
    ...(sent.earlier === true ? { earlier: true } : {}),
  }
  return liveLateAnswers([late, ...live], now)
}

/**
 * Wave 6i (reask.ts): the answer to a re-ask that came AT its moment (this phone was waiting for it): shown at once, like an answer in
 * the dock. Only this one is released; late answers held for the next open stay held.
 */
export function addShownAnswer(list: unknown, sent: SentAskTo, from: string, items: readonly SharedItem[], now: number): LateAnswer[] {
  return addLateAnswer(list, sent, from, items, now).map((a) => (a.id === sent.qid && a.releasedAt === undefined ? { ...a, releasedAt: now } : a))
}

/** The app opened: every held late answer is released now, all at once. */
export function releaseLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).map((a) => (a.releasedAt === undefined ? { ...a, releasedAt: now } : a))
}

/** The late answers to show: released ones only (a held one waits for the next open, whenever it arrived). */
export function shownLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).filter((a) => a.releasedAt !== undefined)
}

/** Wave 6i: dismisses one shown late answer (each has its own card in the stack). */
export function dismissLateAnswer(list: unknown, id: string, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).filter((a) => a.id !== id)
}

/** Dismisses every shown one (the card shows them together). Held ones stay for the next open. */
export function dismissShownLateAnswers(list: unknown, now: number): LateAnswer[] {
  return liveLateAnswers(list, now).filter((a) => a.releasedAt === undefined)
}
