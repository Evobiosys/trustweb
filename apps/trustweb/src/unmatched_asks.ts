/**
 * Wave 6h: "so now that other people show up in my web I want to make sure that they can indeed request me; currently it doesn't show
 * up" (Jakob 2026-10-08 22:59). Reproduced: an ask that matches nothing is silent by design (incoming_query.ts: a decline looks
 * exactly like no match), and a connection made by opening his link is an ACQUAINTANCE on his side, so every line whose "Who can ask"
 * is friends or close friends (the default of lines from a recording) stays silent toward them too. The asked person never saw it.
 *
 * Now, toward the ASKER nothing changes (the same sealed "nothing" at the same moment). The ASKED person gets a quiet card:
 *   "<name> asked about X. Nothing in your resources matched."            (UnmatchedReason.Nothing)
 *   "... A line matched, but its Who can ask leaves out <name> (ring)."  (UnmatchedReason.WhoCanAsk)
 *   "... A line matched, but it is set to Only me."                       (UnmatchedReason.OnlyMe)
 * Only for an ask straight from its asker (never one a front door or a friend passed on: the card's "Message <name>" must reach
 * the person who asked), kept UNMATCHED_KEEP_MS, at most UNMATCHED_MAX, dismissable, and only while Settings > Advanced "Show me asks
 * that matched nothing" is on (default on for a personal account, off on a demo phone). This phone only; never sent.
 * Pure and DOM-free.
 */
import { clipText, isRecord, keptList } from './kept_list'
import type { KeepRule } from './kept_list'
import { Audience, RINGS, UnmatchedReason } from './model'
import type { AppState, UnmatchedAsk } from './model'

export const UNMATCHED_MAX = 20
export const UNMATCHED_KEEP_MS = 7 * 24 * 60 * 60 * 1000
export const UNMATCHED_TEXT_MAX = 300

const REASONS: readonly string[] = Object.values(UnmatchedReason)

const isUnmatched = (v: unknown): v is UnmatchedAsk =>
  isRecord(v) && typeof v.id === 'string' && typeof v.at === 'number' && typeof v.peerId === 'string' && typeof v.from === 'string'
  && typeof v.text === 'string' && typeof v.reason === 'string' && REASONS.includes(v.reason)
  && (v.ring === undefined || (typeof v.ring === 'string' && (RINGS as readonly string[]).includes(v.ring)))

const RULE: KeepRule<UnmatchedAsk> = { is: isUnmatched, keepMs: UNMATCHED_KEEP_MS, max: UNMATCHED_MAX }

export function liveUnmatchedAsks(list: unknown, now: number): UnmatchedAsk[] {
  return keptList(list, RULE, now)
}

/** Adds one (a redelivery of the same ask changes nothing). */
export function addUnmatchedAsk(list: unknown, ask: UnmatchedAsk, now: number): UnmatchedAsk[] {
  const live = liveUnmatchedAsks(list, now)
  if (live.some((a) => a.id === ask.id)) return live
  return liveUnmatchedAsks([{ ...ask, text: clipText(ask.text, UNMATCHED_TEXT_MAX) }, ...live], now)
}

export function dismissUnmatchedAsk(list: unknown, id: string, now: number): UnmatchedAsk[] {
  return liveUnmatchedAsks(list, now).filter((a) => a.id !== id)
}

/** Is the "Show me asks that matched nothing" switch on? Absent: on, except on a demo phone. */
export function showsUnmatched(s: Pick<AppState, 'showUnmatchedAsks'>, demoPhone: boolean): boolean {
  return typeof s.showUnmatchedAsks === 'boolean' ? s.showUnmatchedAsks : !demoPhone
}

/** Why nothing matched, from two wider matches done on this phone only: every ring admitted, and Only-me lines opened as well. */
export function unmatchedReason(matchesAnyRing: boolean, matchesWithOnlyMe: boolean): UnmatchedReason {
  if (matchesAnyRing) return UnmatchedReason.WhoCanAsk
  if (matchesWithOnlyMe) return UnmatchedReason.OnlyMe
  return UnmatchedReason.Nothing
}

/** A copy of the record whose Only-me lines read as close friends' lines: for the reason above only, never for an answer. */
export function withOnlyMeOpened(s: AppState): AppState {
  const open = (a: Audience): Audience => (a === Audience.OnlyMe ? Audience.Close : a)
  return {
    ...s,
    inventory: s.inventory.map((i) => ({ ...i, audience: open(i.audience) })),
    people: s.people.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l, audience: open(l.audience) })) })),
  }
}
