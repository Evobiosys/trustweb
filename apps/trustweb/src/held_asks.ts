/**
 * Wave 6h: a consent prompt that has not been decided is kept in the record (Q5 reproduced: a reload, a new build or a crash lost the
 * prompt, which lived in memory only). On the next start it is shown again and can still be answered: before its moment as usual,
 * after it as a late answer (ask_window.ts) when the asker's build understands one, else at once (the rule of the builds before).
 * Pure and DOM-free.
 */
import { clipText, isRecord } from './kept_list'
import { LATE_KEEP_MS, LATE_TEXT_MAX } from './late_answers'
import type { HeldAsk, LineRef } from './model'

/** Kept at most this many (the newest). */
export const HELD_ASKS_MAX = 20

const isRef = (v: unknown): v is LineRef =>
  isRecord(v) && typeof v.threadId === 'string' && typeof v.text === 'string' && typeof v.context === 'string' && typeof v.at === 'number'

const isHeld = (v: unknown): v is HeldAsk =>
  isRecord(v) && typeof v.qid === 'string' && typeof v.peerId === 'string' && typeof v.text === 'string' && typeof v.fromName === 'string'
  && Array.isArray(v.through) && v.through.every((x) => typeof x === 'string') && (v.doorName === null || typeof v.doorName === 'string')
  && typeof v.relayed === 'boolean' && Array.isArray(v.matches) && v.matches.every(isRef) && typeof v.receivedAt === 'number'
  && typeof v.deadline === 'number' && typeof v.lateMode === 'boolean' && (v.arrivedLate === undefined || typeof v.arrivedLate === 'boolean')
  && (v.yesAt === undefined || typeof v.yesAt === 'number')

/** The held prompts, cleaned: well-formed, none older than LATE_KEEP_MS, oldest first (the order they are shown in), bounded. Never throws. */
export function liveHeldAsks(list: unknown, now: number): HeldAsk[] {
  if (!Array.isArray(list)) return []
  return list.filter(isHeld).filter((h) => now - h.receivedAt <= LATE_KEEP_MS).sort((a, b) => a.receivedAt - b.receivedAt).slice(-HELD_ASKS_MAX)
}

/** Keeps one prompt (a redelivery of the same qid changes nothing). */
export function addHeldAsk(list: unknown, ask: HeldAsk, now: number): HeldAsk[] {
  const live = liveHeldAsks(list, now)
  if (live.some((h) => h.qid === ask.qid)) return live
  return liveHeldAsks([...live, { ...ask, text: clipText(ask.text, LATE_TEXT_MAX) }], now)
}

/** Drops one prompt (decided, or its connection is gone). */
export function dropHeldAsk(list: unknown, qid: string, now: number): HeldAsk[] {
  return liveHeldAsks(list, now).filter((h) => h.qid !== qid)
}
