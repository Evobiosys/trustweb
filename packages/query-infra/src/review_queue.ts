// Owner-review UI (demo/review.html) presentation layer. Pure functions only:
// this module has NO gating authority — it reads the already-computed state
// that gates.ts/query_gateway.ts/red_flags.ts produce and arranges it into
// "what does the owner need to look at, and what can they tap." It never
// decides whether a query may run or what an Approve tap actually does on
// the wire — demo/server.ts still calls applyEvent()/submitQuery() etc. for
// that, exactly as it does for the existing inbox.html.
//
// Two things live here because they're genuinely reusable, testable logic
// independent of any one page: which of an incoming query's next actions is
// "the one big Approve button" for its current gate state (deriving that
// from IntroQuery.state — never inventing a state the machine doesn't have),
// and a staleness/season marker for "dates everywhere" (memo item 5).
import type { QueryState, RequesterPolicy } from "@resource-web/network-access";
import type { TemplateRejectReason } from "./templates.js";

export type QueueCardKind = "pending" | "red_flag";

export interface PendingCardInput {
  kind: "pending";
  id: string;
  requester: string;
  text: string;
  receivedAt: number;
  state: QueryState;
  /** Present when this query arrived through a pre-approved template (D22);
   * absent for a legacy /api/ask query, which is still a valid pending card. */
  template?: { id: string; target: "network" | "vault" };
  /** Gate states — the standing policy, and (when a red-flag trust
   * downgrade is active) the effective policy actually governing this
   * query. Purely presentational: neither field is consulted by this
   * module's own logic, only rendered by the card. */
  policy?: RequesterPolicy;
  effectivePolicy?: RequesterPolicy;
}

export interface RedFlagCardInput {
  kind: "red_flag";
  id: string;
  requester: string;
  receivedText: string;
  ts: string;
  reason: TemplateRejectReason;
  trustDowngradeExpiresAt: string;
  /** ISO timestamp of the most recent restore-trust prompt sent for this
   * flag, if any — lets the card show "already asked" instead of re-firing. */
  restorePromptSentAt?: string;
}

export type QueueCardInput = PendingCardInput | RedFlagCardInput;

/** The one primary action a pending card's current state supports, matching
 * gates.ts's actual transitions exactly (never a state gates.ts doesn't
 * have): awaiting_gate0 → allow/decline the query itself; awaiting_run → the
 * only next step is running the matcher (gates.ts has no "decline" event at
 * this state, so none is offered here); awaiting_reveal → share the
 * anonymized aggregate (the k-anonymity-safe default) or decline. */
export type PrimaryAction =
  | { approve: "gate0_allow"; decline: "gate0_block" }
  | { approve: "run_small" }
  | { approve: "reveal_anonymized"; decline: "decline_reveal" }
  | { approve: null };

export function primaryActionFor(state: QueryState): PrimaryAction {
  switch (state) {
    case "awaiting_gate0":
      return { approve: "gate0_allow", decline: "gate0_block" };
    case "awaiting_run":
      return { approve: "run_small" };
    case "awaiting_reveal":
      return { approve: "reveal_anonymized", decline: "decline_reveal" };
    default:
      return { approve: null };
  }
}

const ACTIONABLE_STATES = new Set<QueryState>(["awaiting_gate0", "awaiting_run", "awaiting_reveal"]);

export interface PendingCard extends PendingCardInput {
  actionable: boolean;
  action: PrimaryAction;
}

export interface RedFlagCard extends RedFlagCardInput {
  actionable: false;
  restorePromptSent: boolean;
}

export type QueueCard = PendingCard | RedFlagCard;

/** Builds the ordered owner-review queue: actionable pending queries and
 * red-flag cards together, newest first, so "front and center" means one
 * scroll, not two separate pages. Terminal-state queries (already responded/
 * declined/expired) are filtered out here — they belong in the processed/
 * trace list, not the approval queue. */
export function buildReviewQueue(cards: QueueCardInput[]): QueueCard[] {
  const built: QueueCard[] = cards.map((c) => {
    if (c.kind === "red_flag") {
      return { ...c, actionable: false, restorePromptSent: Boolean(c.restorePromptSentAt) };
    }
    return { ...c, actionable: ACTIONABLE_STATES.has(c.state), action: primaryActionFor(c.state) };
  });
  return built
    .filter((c) => c.kind === "red_flag" || c.actionable)
    .sort((a, b) => timeOf(b) - timeOf(a));
}

function timeOf(c: QueueCard): number {
  return c.kind === "red_flag" ? Date.parse(c.ts) : c.receivedAt;
}

// --- Staleness / "dates everywhere" (memo item 5) --------------------------

const SEASONS = [
  { name: "winter", months: [12, 1, 2] },
  { name: "spring", months: [3, 4, 5] },
  { name: "summer", months: [6, 7, 8] },
  { name: "autumn", months: [9, 10, 11] },
] as const;

const THIRDS = ["early", "mid", "late"] as const;

/** "late summer 2026" style label, Northern-hemisphere/Europe convention
 * (this project's default region) — a coarser, more human-legible staleness
 * signal than a raw date, meant to sit next to (never replace) the exact
 * ISO timestamp every surface already shows. */
export function seasonLabel(atMs: number): string {
  const d = new Date(atMs);
  const month = d.getUTCMonth() + 1;
  const season = SEASONS.find((s) => (s.months as readonly number[]).includes(month))!;
  const dayThird = Math.min(2, Math.floor((d.getUTCDate() - 1) / 10));
  // Winter spans a year boundary (Dec belongs to the following winter/year
  // pairing convention used loosely here) — keep it simple: label with the
  // calendar year of the timestamp itself, not the "winter season" year.
  return `${THIRDS[dayThird]} ${season.name} ${d.getUTCFullYear()}`;
}

export const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 30 * 3; // ~3 months

export interface Staleness {
  ageMs: number;
  stale: boolean;
  /** Present only when stale — the ⓘ note text pairing the exact date with
   * a coarser "how old is this, roughly" read. */
  seasonNote?: string;
}

export function staleness(atMs: number, now: number = Date.now()): Staleness {
  const ageMs = Math.max(0, now - atMs);
  const stale = ageMs > STALE_AFTER_MS;
  return stale ? { ageMs, stale, seasonNote: `recorded ${seasonLabel(atMs)} — verify still current` } : { ageMs, stale };
}
