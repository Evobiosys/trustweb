/**
 * Wave 6h: the quiet cards under the header that are about asks, one at a time, in this order:
 *   1. Late   (the asker's side): "<name> answered later", every released late answer together as ONE card (late_answers.ts)
 *   2. Unmatched (the asked side): "<name> asked about X; nothing matched" (unmatched_asks.ts), while its switch is on
 *   3. Away   (the asked side, wave 6f): "<name> asked while you were away" (away_asks.ts)
 * Pure and DOM-free: main.ts draws the card this returns.
 */
import { liveAwayAsks } from './away_asks'
import { shownLateAnswers } from './late_answers'
import type { AppState, AwayAsk, LateAnswer, UnmatchedAsk } from './model'
import { liveUnmatchedAsks, showsUnmatched } from './unmatched_asks'

export enum AskCardKind {
  Late = 'late',
  Unmatched = 'unmatched',
  Away = 'away',
}

export type AskCard =
  | { kind: AskCardKind.Late; answers: LateAnswer[] }
  | { kind: AskCardKind.Unmatched; ask: UnmatchedAsk; more: number }
  | { kind: AskCardKind.Away; ask: AwayAsk; more: number }

/** The card to show now, or null. `demoPhone`: the default of the "matched nothing" switch is off there. */
export function nextAskCard(s: Pick<AppState, 'lateAnswers' | 'unmatchedAsks' | 'awayAsks' | 'showUnmatchedAsks'>, now: number, demoPhone: boolean): AskCard | null {
  const late = shownLateAnswers(s.lateAnswers, now)
  if (late.length) return { kind: AskCardKind.Late, answers: late }
  const unmatched = showsUnmatched(s, demoPhone) ? liveUnmatchedAsks(s.unmatchedAsks, now) : []
  if (unmatched.length) return { kind: AskCardKind.Unmatched, ask: unmatched[0], more: unmatched.length - 1 }
  const away = liveAwayAsks(s.awayAsks, now)
  if (away.length) return { kind: AskCardKind.Away, ask: away[0], more: away.length - 1 }
  return null
}
