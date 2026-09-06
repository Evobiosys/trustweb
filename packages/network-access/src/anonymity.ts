// k-anonymity floor for aggregate responses. Below k matches, an aggregate
// would identify people ("1 of 100 match" usually means the requester can
// guess who) — so it is suppressed. Suppressed and zero-match responses must
// stay byte-identical outward: a distinguishable suppressed response would
// itself leak "between 1 and k-1 people match".
//
// Scope note (ADR-3 / retired WEB-3 in docs/20-data-contract.md forbids
// aggregate counts about non-visible second-ring people): this aggregate is a
// different object — it counts the owner's own first-ring contacts and is
// released only by the owner's explicit Gate-2 consent (or a standing
// auto_anonymized grant the owner set). Flagged for contract review before
// this package is mounted into the daemon wire protocol.
import type { OutwardResponse } from "./types.js";

// The single k-anonymity floor for the whole workspace. Every other module
// reads this constant; nothing declares a second one. The rebiosys fork
// raised its own copy to 7 (Jakob, 2026-08-25 owner decision, DECISIONS.md
// D24, rebiosys commit 0613fb1: "set the default floor to 7, and let people
// adjust that in contracts with each other"), and packages/query-infra held a
// vault-specific duplicate of 7 as well. Both duplicates were deleted when
// query-infra was ported into this trunk (decision B-03, option A); the value
// kept is the trunk's 3, because the prevalence measurement (C-08) has not
// run yet and F-07 rules that the floor is not to be tuned before it does.
// Raising this to 7 is a one-line change here once C-08 reports.
//
// Per-peer overrides live in packages/query-infra/src/contracts.ts
// (effectiveK / effectiveKFor): they may raise the floor freely, and lower it
// only with mutual:true and never below MIN_K, declared just below.
export const DEFAULT_K = 3;

// The hard minimum any per-peer contract may lower the floor to, however
// mutual the agreement. Derived from DEFAULT_K rather than written as a
// literal, so the two move together when the C-08 prevalence run retunes the
// default: exactly one step of slack below it, and never below 2, because at
// k = 1 an "N of M" aggregate identifies a single individual outright, which
// is the thing k-anonymity exists to prevent.
//
// At DEFAULT_K = 3 this is 2, the value the rebiosys port carried in
// query-infra's contracts.ts. Under the fork's floor of 7 the same literal 2
// left a five-step gap, which changed what the mutual-flag guardrail meant;
// tying the two keeps that gap at one step whatever the default becomes.
// contracts.ts re-exports this so its existing import path still resolves.
export const MIN_K = Math.max(2, DEFAULT_K - 1);

export const NOTHING_SHAREABLE_TEXT = "No shareable result for this request.";

export type RevealDecision =
  | { kind: "none" }
  | { kind: "suppressed"; matchCount: number }
  | { kind: "anonymized"; matchCount: number; totalCount: number };

export function anonymizedRevealDecision(
  matchCount: number,
  totalCount: number,
  k: number = DEFAULT_K,
): RevealDecision {
  if (matchCount <= 0) return { kind: "none" };
  if (matchCount < k) return { kind: "suppressed", matchCount };
  return { kind: "anonymized", matchCount, totalCount };
}

export function outwardAnonymizedResponse(decision: RevealDecision): OutwardResponse {
  if (decision.kind === "anonymized") {
    return {
      kind: "anonymized",
      text: `${decision.matchCount} of ${decision.totalCount} people in this network are sharing what you asked about.`,
      matchCount: decision.matchCount,
      totalCount: decision.totalCount,
    };
  }
  return { kind: "nothing_shareable", text: NOTHING_SHAREABLE_TEXT };
}
