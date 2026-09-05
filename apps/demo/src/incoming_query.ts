/**
 * The one decision that separates "this device shows something" from "this
 * device shows nothing" for a query that arrived AMBIENTLY -- over an
 * already-open relay/webrtc channel, with nobody having chosen to scan
 * anything (main.ts's handleAmbientQuery is the only caller). A manual QR
 * scan (screenAnswer's "Frage scannen" button, demo 1's whole flow) is a
 * different, inherently interactive path this function does not gate: a
 * person who just tapped "scan a query" has already chosen to look, so
 * showing them the consent ceremony regardless of match is not an
 * interruption in the sense this module cares about. See
 * runConsentCeremony's doc comment in main.ts.
 *
 * Deliberately pure and DOM-free, in its own module rather than folded into
 * main.ts, for exactly one reason: it must be the SAME function the app
 * calls and the acceptance test asserts on. A test that recomputes
 * `match.aboveThreshold` itself is testing a proxy for the app's decision,
 * not the decision -- a bug where the silent path still renders (e.g. a
 * send helper that calls shell() on success) would leave such a test green
 * while the demo visibly breaks. Importing this function is what closes
 * that gap.
 */

import type { LocalOutcome, MatchResult } from './types'

export interface QueryClassification {
  /** True: this device must run the consent ceremony (a screen change).
   *  False: this device answers automatically, with no visible change. */
  surface: boolean
  /**
   * The LocalOutcome this device has already reached, for logging AND for
   * gate.ts's decide() (`consent: false` is implied automatically in every
   * non-surfaced case; see main.ts's handleAmbientQuery). `null` only when
   * `surface` is true -- a human still has to tap yes/no before an outcome
   * of 'shared' or 'declined' exists; runConsentCeremony/emitAnswer supply
   * that outcome afterwards, from gate.ts's own decide().
   */
  outcome: LocalOutcome | null
}

/**
 * `muted`/`cooldownBlocked` (cooldown.ts, 2026-09-06): two more standing,
 * ahead-of-any-match reasons this device silences an ask, checked in the
 * same position as `blocked` and for the same reason -- see that
 * parameter's own established precedent in this function. Order matters
 * only in which LocalOutcome gets recorded when more than one would apply
 * at once (blocked outranks muted outranks cooldown, matching gate.ts's own
 * `decide()` ordering so the two functions never disagree about which
 * label wins); the wire-visible result (silent, "nothing") is identical
 * regardless of the order, since all three fold into the same `!surface`
 * branch.
 */
export function classifyIncomingQuery(
  match: MatchResult,
  blocked: boolean,
  templateResolved: boolean,
  muted = false,
  cooldownBlocked = false,
): QueryClassification {
  if (!templateResolved) {
    // An unresolvable template id (corrupt payload, unknown/expired id) and
    // no free text to fall back to. There is nothing to match and nothing to
    // show -- silently declines exactly like a genuine no-match, and is
    // logged as one (see this repo's I6: every received query is logged,
    // including the ones a device cannot even parse into a real question).
    return { surface: false, outcome: 'no-match' }
  }
  if (blocked) return { surface: false, outcome: 'blocked' }
  if (muted) return { surface: false, outcome: 'muted' }
  if (cooldownBlocked) return { surface: false, outcome: 'cooldown' }
  if (!match.aboveThreshold) {
    return { surface: false, outcome: match.hits.length === 0 ? 'no-match' : 'below-k' }
  }
  return { surface: true, outcome: null }
}
