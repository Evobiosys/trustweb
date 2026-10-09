/**
 * Wave 6i, THE ONE THING ("an ask and its answer stay one conversation"), its third part. Jakob 2026-10-09: "if I switch [a person]
 * from acquaintance to friend, I see her old asks, because she carried that as a log on her device; this should only happen when we
 * make people tighter; unfriending should be invisible."
 *
 *   A TIGHTENS B's ring (Intending -> Acquaintance -> Friend -> Close, one or more steps; or presses "Get their earlier asks again" on
 *   B's card): A's phone sends B ONE sealed "ask-again" envelope (apps/demo types.ts AskAgainEnvelope). It carries no ring and no text.
 *   B's phone re-sends to A the asks B made to A in the last REASK_WINDOW_MS that A never answered with a share (B's own log, the
 *   remembered asks of late_answers.ts: a share at the moment or later forgets that connection's entry), newest first, at most
 *   REASK_MAX, each through the ordinary ask path to A ONLY (a fresh qid, direct, the answer window, a fixed moment), marked
 *   `reask: {originalQid, originalAt}`. A sees "Earlier ask from <B> (<date>)" and answers as usual; B gets the answer at its moment.
 *   LOOSENING SENDS NOTHING: a lower ring, a removed person, pass-on switched off: no envelope at all, so B's phone cannot notice it.
 *
 * Bounds: B re-sends one earlier ask to one connection at most REASKS_PER_ASK times (one per possible tightening) and answers one
 * ask-again per connection at most once per ASK_AGAIN_COOLDOWN_MS; A shows the same earlier ask again only when the asker's ring is
 * tighter than when it last came (ReaskSeen), so a double tap or a lower-then-raise never repeats a prompt. A re-ask that still matches
 * nothing stays silent on A's side (no card, no log row): one tightening must not bring twenty "nothing matched" cards; it is not
 * remembered as shown, so a later tightening or the Advanced button may bring it again (review 6i). A reads the `reask` marker only
 * from a connection it sent an ask-again to within REASK_ACCEPT_MS (review 6i): a forged marker is an ordinary ask, logged and carded.
 * Pure and DOM-free.
 */
import { clipText, isRecord, keptList } from './kept_list'
import type { KeepRule } from './kept_list'
import { liveSentAsks } from './late_answers'
import { RINGS, Ring } from './model'
import type { ReaskSeen, SentAsk, SentTo } from './model'
import type { QueryEnvelope, ReaskRef } from '../../demo/src/types'
import { FREE_TEXT_MAX_LEN, QID_RE } from '../../demo/src/types'

/** How far back a re-ask reaches. */
export const REASK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/** The most earlier asks one ask-again brings back. */
export const REASK_MAX = 20
/** How often one earlier ask is re-sent to one connection at most: once per possible tightening (Intending -> ... -> Close). */
export const REASKS_PER_ASK = RINGS.length - 1
/** One ask-again per connection is answered at most this often (a burst of taps or of ring changes sends one round). */
export const ASK_AGAIN_COOLDOWN_MS = 60_000
/**
 * Review 6i: the receiver reads an ask's `reask` marker only from a connection it sent an ask-again to within this long (the asker's
 * phone may be closed for days before it reads the ask-again). Any other marked ask is an ordinary ask: logged, carded, shown as new, so
 * a marker can never hide an ask from the log or take a card away.
 */
export const REASK_ACCEPT_MS = 14 * 24 * 60 * 60 * 1000
/** A receiver kept this many earlier asks it was asked again. */
export const REASK_SEEN_MAX = 200
/** An earlier ask's claimed time may lie this far ahead of the receiver's clock (clock skew) before it is not shown. */
const CLOCK_SKEW_MS = 10 * 60 * 1000
/** ... and this much further back than the window (a re-ask sent at the edge of it, delivered late). */
const LATE_SLACK_MS = 7 * 24 * 60 * 60 * 1000

/** Does going from `from` to `to` make the person closer (a tightening)? The same ring, a looser one or an unknown value: no. */
export function ringRaised(from: Ring, to: Ring): boolean {
  const a = RINGS.indexOf(from)
  const b = RINGS.indexOf(to)
  return a !== -1 && b !== -1 && b < a
}

/** One earlier ask to send again to one connection. */
export interface ReaskPlan {
  /** This phone's id of the ask (SentAsk.id). */
  askId: string
  text: string
  /** When it was first asked. */
  firstAt: number
  /** The qid that connection got the first time. */
  originalQid: string
  /** Review 6i: that connection's entry as it is now, put back when the re-ask does not leave (undoReasked). */
  prev: SentTo
}

/**
 * B's side: the earlier asks to send again to the connection `peerId`. Only asks that went to THAT connection and were never answered
 * there with a share (still in `to`), made within REASK_WINDOW_MS, re-sent fewer than REASKS_PER_ASK times, not waited for right now
 * (`inFlight`); newest first, REASK_MAX.
 */
export function reaskCandidates(sentAsks: unknown, peerId: string, now: number, inFlight: (qid: string) => boolean = () => false): ReaskPlan[] {
  const out: ReaskPlan[] = []
  for (const a of liveSentAsks(sentAsks, now)) {
    if (out.length >= REASK_MAX) break
    if (now - a.at > REASK_WINDOW_MS || !a.text.trim()) continue
    const to = a.to.find((x) => x.peerId === peerId)
    // An ask whose answer this phone still waits for is not asked again (its answer is on its way).
    if (!to || (to.reasks ?? 0) >= REASKS_PER_ASK || inFlight(to.qid)) continue
    out.push({ askId: a.id, text: a.text, firstAt: a.at, originalQid: to.reaskOf ?? to.qid, prev: { ...to } })
  }
  return out
}

/** B's side: the remembered ask now points that connection at the re-ask's qid (a late yes to it still lands; a share forgets it). */
export function noteReasked(sentAsks: unknown, askId: string, peerId: string, qid: string, now: number): SentAsk[] {
  return liveSentAsks(sentAsks, now).map((a) => (a.id !== askId ? a : {
    ...a,
    to: a.to.map((x) => (x.peerId !== peerId ? x : { peerId, qid, at: now, reaskOf: x.reaskOf ?? x.qid, reasks: (x.reasks ?? 0) + 1 })),
  }))
}

/**
 * B's side, review 6i: the re-ask did not leave (the relay refused it): the remembered ask points that connection back at what it was,
 * so a late yes to the earlier qid still lands and the failed try costs nothing of the REASKS_PER_ASK budget.
 */
export function undoReasked(sentAsks: unknown, askId: string, peerId: string, prev: SentTo, now: number): SentAsk[] {
  return liveSentAsks(sentAsks, now).map((a) => (a.id !== askId ? a : { ...a, to: a.to.map((x) => (x.peerId !== peerId ? x : prev)) }))
}

/** The fields of a re-ask (on top of the ordinary ask's): direct only, never passed on, marked with the earlier ask. */
export function reaskFields(plan: ReaskPlan): Pick<QueryEnvelope, 'direct' | 'reask'> {
  return { direct: true, reask: { originalQid: plan.originalQid, originalAt: plan.firstAt } }
}

/** The words a re-ask carries: the first ask's, trimmed and bounded like any ask. */
export function reaskText(plan: ReaskPlan): string {
  return clipText(plan.text.trim(), FREE_TEXT_MAX_LEN)
}

/** B's side: may an ask-again from this connection start a round now (none running, none in the last ASK_AGAIN_COOLDOWN_MS)? */
export function askAgainAllowed(lastAt: number | undefined, running: boolean, now: number): boolean {
  return !running && (lastAt === undefined || now - lastAt >= ASK_AGAIN_COOLDOWN_MS)
}

// ---------------------------------------------------------------------------
// A's side: an earlier ask that came again
// ---------------------------------------------------------------------------

/**
 * A's side, review 6i: does this phone read a `reask` marker from this connection at all? Only when it sent them an ask-again within
 * REASK_ACCEPT_MS (Peer.askAgainSentAt); a marker nobody asked for is ignored and the ask is an ordinary one.
 */
export function acceptsReaskFrom(askAgainSentAt: unknown, now: number): boolean {
  return typeof askAgainSentAt === 'number' && Number.isFinite(askAgainSentAt) && askAgainSentAt <= now + CLOCK_SKEW_MS
    && now - askAgainSentAt <= REASK_ACCEPT_MS
}

/** What the receiver makes of a well-formed `reask` field: the first ask's qid, and its time when that is believable (else null). */
export interface EarlierAsk {
  originalQid: string
  /** When it was first asked, on the asker's clock; null when the claimed time is not believable (it is then shown without a date). */
  at: number | null
}

export function earlierAsk(reask: ReaskRef | undefined, receivedAt: number): EarlierAsk | null {
  if (!reask || !QID_RE.test(reask.originalQid)) return null
  const t = reask.originalAt
  const believable = Number.isFinite(t) && t <= receivedAt + CLOCK_SKEW_MS && receivedAt - t <= REASK_WINDOW_MS + LATE_SLACK_MS
  return { originalQid: reask.originalQid, at: believable ? Math.min(t, receivedAt) : null }
}

const isSeen = (v: unknown): v is ReaskSeen =>
  isRecord(v) && typeof v.id === 'string' && typeof v.at === 'number' && typeof v.peerId === 'string'
  && typeof v.ring === 'string' && (RINGS as readonly string[]).includes(v.ring)

const SEEN_RULE: KeepRule<ReaskSeen> = { is: isSeen, keepMs: REASK_WINDOW_MS + LATE_SLACK_MS, max: REASK_SEEN_MAX }

export function liveReaskSeen(list: unknown, now: number): ReaskSeen[] {
  return keptList(list, SEEN_RULE, now)
}

/** A's side: show this earlier ask? Only when it never came again from this connection, or came at a looser ring than `ring` now. */
export function showsEarlierAsk(list: unknown, originalQid: string, peerId: string, ring: Ring, now: number): boolean {
  const last = liveReaskSeen(list, now).find((x) => x.id === originalQid && x.peerId === peerId)
  return !last || ringRaised(last.ring, ring)
}

/** A's side: remember that this earlier ask came again at `ring` (replacing what was kept for it). */
export function noteEarlierAsk(list: unknown, originalQid: string, peerId: string, ring: Ring, now: number): ReaskSeen[] {
  const rest = liveReaskSeen(list, now).filter((x) => !(x.id === originalQid && x.peerId === peerId))
  return liveReaskSeen([{ id: originalQid, at: now, peerId, ring }, ...rest], now)
}
