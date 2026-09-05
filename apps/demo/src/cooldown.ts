/**
 * Repeat-asking cooldown (Jakob, 2026-09-06 -- HANDOVER-build-session-2026-09-04.md
 * §0.C: "Repeat asking is unlimited... it is exactly the kind of
 * 'unangenehme Situation' the three modes exist to prevent").
 *
 * The problem this closes: nothing stopped the same asker sending the same
 * question again and again. This module adds a per-(asker, template-or-query-
 * text) cooldown, a device-wide policy to turn it off, a per-peer mute, and a
 * single-use "this is very important" escalation that can pass through the
 * cooldown once per window.
 *
 * ENFORCEMENT LIVES ON THE RECEIVING DEVICE. `AskCooldownRecord` (types.ts)
 * is stored in DeviceState.askCooldowns on the device being asked, never
 * transmitted, and the asker has no way to write to it. An asker's own
 * device may keep a best-effort, cosmetic COPY of the same shape
 * (DeviceState.escalationHints, main.ts's screenAsk) purely to greyed out its
 * own "very important" button before sending -- that copy is a UI hint, not
 * a source of truth, and the recipient never reads or trusts it. See
 * `QueryEnvelope.escalated`'s own doc comment (types.ts) for why setting
 * that wire field twice does not grant a second escalation.
 *
 * Pure math (`decideAsk`) is exported and unit-tested directly -- see
 * test/cooldown.test.ts -- deliberately kept DOM- and state-free, same
 * discipline as incoming_query.ts's `classifyIncomingQuery`, so a test can
 * assert on the actual decision function the app calls rather than a
 * recomputed proxy for it.
 */

import type { AskCooldownRecord } from './types'

/**
 * Default cooldown: 24 hours. Chosen, not measured -- there is no usage data
 * yet (the app has no users beyond the two 2026-09-01 pilot testers). 24h is
 * long enough that the same evening's "did anyone see my lost cat" cannot be
 * repeated three times before anyone has had a chance to answer once, short
 * enough that a genuinely new day's version of the same question is not
 * mistaken for nagging. A single exported constant, not a magic number
 * repeated at call sites, so a future tuning pass (once C-08's prevalence
 * measurement exists) has exactly one place to change it.
 */
export const ASK_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Device-wide cooldown posture (DeviceState.cooldownPolicy). Absent reads as
 *  `'default'` -- see this module's `cooldownPolicy()` -- the same
 *  absent-means-safe-default convention state.ts already uses throughout
 *  this file (I9: a person who never opens the setting gets the protective
 *  behaviour, not the permissive one). */
export type CooldownPolicy = 'default' | 'off'

/**
 * The cooldown key: (asker, template-or-query-text). Deliberately does NOT
 * include which peer relayed the ask, or which of this device's own peers
 * are being asked -- this is the RECEIVING device's own local view, so
 * "peer" is implicit (it is always this device). A free-text ask keys on its
 * own verbatim text (`q.freeText`) rather than the shared FREE_TEXT_TEMPLATE_ID
 * sentinel, so two DIFFERENT free-text questions from the same asker do not
 * share a cooldown window -- they are, honestly, different asks -- while the
 * SAME free-text question repeated verbatim does. A fixed-template ask keys
 * on the template id, since the question itself is not chosen by the asker
 * to begin with.
 *
 * U+241F (SYMBOL FOR UNIT SEPARATOR) joins the two halves: astronomically
 * unlikely to occur in either an 8-char peer id (crypto.ts's `randomId`) or
 * a free-text ask (capped at FREE_TEXT_MAX_LEN plain-language characters),
 * so no real input can forge a collision between two different keys.
 */
export function cooldownKey(askerId: string, templateOrText: string): string {
  return `${askerId}␟${templateOrText}`
}

/** What actually identifies "the same ask" for QueryEnvelope.templateId vs
 *  .freeText -- see cooldownKey's own doc comment on why free text keys on
 *  its own text rather than the shared sentinel id. The one place both
 *  main.ts callers (ambient and manual-scan) compute this, so they can never
 *  drift into keying differently for the same envelope shape. */
export function askIdentityKey(q: { templateId: string; freeText?: string }): string {
  return q.freeText ?? q.templateId
}

export interface CooldownDecision {
  /** True: this ask may proceed to the ordinary match/consent path. False:
   *  the receiving device must silently drop it (LocalOutcome 'cooldown'),
   *  logged, never surfaced. */
  allow: boolean
  /** True only when `allow` is true BECAUSE an escalation was just spent --
   *  the caller uses this to mark the wire-visible "escalated (single use)"
   *  notice main.ts's consent ceremony shows the answering person. Never
   *  true when `allow` is true for an ordinary (non-cooldown-blocked) reason
   *  -- an ask that was never in cooldown to begin with does not "use" an
   *  escalation even if the asker happened to set the flag. */
  escalationConsumed: boolean
  reason:
    | 'first-ask'
    | 'window-elapsed'
    | 'policy-off'
    | 'escalation-granted'
    | 'cooldown-active'
    | 'escalation-already-used'
  /** The record the caller must persist (state.ts's `DeviceState.askCooldowns`
   *  / `.escalationHints`) after this decision -- `undefined` only when
   *  `allow` is false and nothing about the stored record should change
   *  (a dropped repeat ask does not reset, extend, or otherwise touch the
   *  window it was dropped for being inside). */
  nextRecord?: AskCooldownRecord
}

/**
 * The one function both main.ts's `handleAmbientQuery` (ambient path) and
 * `runConsentCeremony`/`emitAnswer` (manual-scan path) call to decide
 * whether an incoming ask may proceed at all, BEFORE any match/consent
 * logic runs. Pure: takes the existing record (or none), the policy, `now`,
 * and whether this specific ask carried `escalated: true`; returns the
 * decision plus the record to persist. Never touches DeviceState directly --
 * see cooldown.ts's module doc for why the persistence boundary matters.
 */
export function decideAsk(params: {
  record: AskCooldownRecord | undefined
  now: number
  cooldownMs: number
  policy: CooldownPolicy
  escalationRequested: boolean
}): CooldownDecision {
  const { record, now, cooldownMs, policy, escalationRequested } = params

  if (policy === 'off') {
    // No cooldown enforced at all -- still track a window (for an honest
    // Protokoll / future re-enable of the default), but every ask is allowed
    // through regardless of it.
    return {
      allow: true,
      escalationConsumed: false,
      reason: 'policy-off',
      nextRecord: { windowStartAt: record?.windowStartAt ?? now, escalationUsedInWindow: record?.escalationUsedInWindow ?? false },
    }
  }

  const withinWindow = record !== undefined && now - record.windowStartAt < cooldownMs
  if (!withinWindow) {
    // First-ever ask for this key, OR the previous window has naturally
    // elapsed: open a fresh window. A fresh window always has its
    // escalation unspent, regardless of whether the PRIOR window's was --
    // "gone until the cooldown naturally expires" is exactly this branch.
    return {
      allow: true,
      escalationConsumed: false,
      reason: record ? 'window-elapsed' : 'first-ask',
      nextRecord: { windowStartAt: now, escalationUsedInWindow: false },
    }
  }

  // Within the window: ordinarily blocked, UNLESS an unspent escalation is
  // being spent right now. The window's own start does not move -- only
  // `escalationUsedInWindow` flips, so the cooldown still expires on its
  // original schedule (see this module's own doc comment on `nextRecord`
  // for `window-elapsed` above, and AskCooldownRecord's doc comment in
  // types.ts).
  if (escalationRequested && !record.escalationUsedInWindow) {
    return {
      allow: true,
      escalationConsumed: true,
      reason: 'escalation-granted',
      nextRecord: { windowStartAt: record.windowStartAt, escalationUsedInWindow: true },
    }
  }

  return {
    allow: false,
    escalationConsumed: false,
    reason: escalationRequested ? 'escalation-already-used' : 'cooldown-active',
    // No `nextRecord`: a dropped ask must not itself alter the window it was
    // dropped for being inside (see this interface's own doc comment).
  }
}
