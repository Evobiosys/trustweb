/**
 * "Is this safe?" (wave 6e, owner 2026-10-08 16:12: "I want to be able to explain to them that there is no risk with that ... how can I
 * assure them that this is not malware"): one small sheet of plain sentences, reachable from three places: the Add sheet on a scan landing
 * (a small link, FIRST time only), a person's card, and Settings > About. The sentences are strings.ts (S.safe*); the same ones are used
 * by the website (E3).
 *
 * The app never claims its code is public by default: the public repository is old and publishing is blocked (decision #23). The line
 * about reading the code on GitHub exists in a build only when it was made with VITE_TW_CODE_PUBLIC=1 (site: TW_CODE_PUBLIC=1); in every
 * other build the sentence is not in the bundle at all (strings.ts folds it away at build time). No GitHub link in this wave.
 *
 * Pure and DOM-free.
 */
import { S } from './strings'

/** Where the sheet can be opened from. */
export enum SafetyPlace {
  AddSheet = 'add-sheet',
  PersonCard = 'person-card',
  Settings = 'settings',
}

/** The sentences of the sheet, in order. `withCodeLine` adds the open-source sentence; it is empty in a build made without the flag. */
export function safetyLines(withCodeLine: boolean = S.safeCodePublic !== ''): string[] {
  const base = [S.safeS1, S.safeS2, S.safeS3, S.safeS4, S.safeS5]
  return withCodeLine && S.safeCodePublic !== '' ? [...base, S.safeCodePublic] : base
}

/** The small link on the Add sheet shows the first time only. */
export function offerFirstTime(state: { safetyLinkShownAt?: number }): boolean {
  return state.safetyLinkShownAt === undefined
}

/** Remembers that the link was shown. True when the state changed (the first time only). */
export function markFirstTimeShown(state: { safetyLinkShownAt?: number }, now: number): boolean {
  if (state.safetyLinkShownAt !== undefined) return false
  state.safetyLinkShownAt = now
  return true
}
