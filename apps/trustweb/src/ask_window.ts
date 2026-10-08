/**
 * Wave 6h: the answer window of an ask (Jakob 2026-10-08 22:59: "What does it mean that every answer is held until about 60 seconds
 * after you asked? Does it mean that it's just saved for 60 seconds? If so, that's short. Let's make it longer.").
 *
 * The window is not storage (the relay keeps an ask for days): it is the ANSWER MOMENT. Every answer, yes, no, no match or a phone
 * that is off, reaches the asker at the same fixed moment, one window per step after the ask, so WHEN an answer comes says nothing;
 * the asked person has that window to say yes. Before 6h the window was 30 s (apps/demo gate.ts RELAY_DEADLINE_MS) and a person
 * who decided later was answered the moment they decided, which told the asker that somebody had looked at a prompt.
 *
 * Since 6h:
 *   - A direct ask waits ANSWER_WINDOW_MS (120 s; a two-step ask about 4 min). The asker sends its window on the ask
 *     (QueryEnvelope.answerWindowMs), and every phone that passes it on copies it, so asker, phones and steps agree whatever
 *     build each of them runs.
 *   - At its moment the asked phone answers with what it has; an undecided prompt answers "nothing", the same bytes as a no.
 *   - A yes after the moment travels as a LATE answer (late_answers.ts): the asker's app keeps it silently and shows
 *     "<name> answered later" the next time it is opened, never live.
 *   - An ask WITHOUT the field (an older asker, a front door of services/trustweb-peer, an older phone passing it on) keeps the
 *     30 s window and the answer-when-decided rule exactly, so the front door's own wait for its owner still fits.
 *
 * Pure and DOM-free.
 */
import { RELAY_DEADLINE_MS } from '../../demo/src/gate'
import { ANSWER_WINDOW_MS_MAX } from '../../demo/src/types'
import type { QueryEnvelope } from '../../demo/src/types'

/** The answer window of this build's asks: two minutes (why not ten: the asker waits in front of the dock; a late yes covers the rest). */
export const ANSWER_WINDOW_MS = 120_000
/** The window of an ask that carries none: the builds before 6h, and every front door. */
export const LEGACY_WINDOW_MS = RELAY_DEADLINE_MS

export { ANSWER_WINDOW_MS_MAX }

/** The field this phone's asks carry: its own window. */
export function windowFields(windowMs: number): Pick<QueryEnvelope, 'answerWindowMs'> {
  return { answerWindowMs: Math.min(ANSWER_WINDOW_MS_MAX, Math.max(1, Math.round(windowMs))) }
}

/** Does this ask follow the 6h rules (answer at the moment, a later yes as a late answer)? */
export function carriesWindow(q: Pick<QueryEnvelope, 'answerWindowMs'>): boolean {
  return typeof q.answerWindowMs === 'number' && Number.isInteger(q.answerWindowMs) && q.answerWindowMs > 0
}

/**
 * The window a received ask is answered in. Carried: the asker's, kept between the legacy window and this build's (a stranger cannot
 * make a phone answer at once, nor hold it for ten minutes). Absent: the legacy window. `ownWindowMs` is this phone's own window
 * (ANSWER_WINDOW_MS in production; tests pass a shorter one, which lowers the floor with it).
 */
export function receivedWindowMs(q: Pick<QueryEnvelope, 'answerWindowMs'>, ownWindowMs: number): number {
  const floor = Math.min(LEGACY_WINDOW_MS, ownWindowMs)
  if (!carriesWindow(q)) return floor
  const cap = Math.max(ANSWER_WINDOW_MS, ownWindowMs)
  return Math.min(cap, Math.max(floor, q.answerWindowMs as number))
}

/** The window copied onto an ask this phone passes on: the one it received under, so every step keeps the asker's schedule. */
export function passOnWindowFields(q: Pick<QueryEnvelope, 'answerWindowMs'>, receivedMs: number): Pick<QueryEnvelope, 'answerWindowMs'> {
  return carriesWindow(q) ? windowFields(receivedMs) : {}
}
