// Red-flag handling (memo item 2). A query that deviates from its approved
// template — different text, different requester, an unknown/tampered
// template id — is REJECTED and logged locally with Jakob's classification:
// "either you've been hacked, or you're a malicious actor". The rejection
// also emits a temporary trust-downgrade event, surfaced to the owner (never
// to the requester — see the outward-text rule below).
//
// Outward-facing invariant, load-bearing for the whole project's privacy
// pitch (mirrors anonymity.ts's NOTHING_SHAREABLE_TEXT convention): a
// red-flagged query gets the exact same bland outward text as a query that
// simply matched nothing. Anyone holding a stolen/guessed template id must
// not be able to distinguish "wrong text" from "wrong requester" from
// "no match" from the response bytes alone — that would turn rejection
// reasons into an oracle for probing the approved query. All of the
// interesting detail (which reason, the classification, the trust
// downgrade) lives ONLY in the local log / owner-side trace.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TemplateRejectReason } from "./templates.js";
import type { RequesterPolicy } from "@resource-web/network-access";

export const REJECTED_OUTWARD_TEXT = "No shareable result for this request.";

export const DEFAULT_TRUST_DOWNGRADE_DELTA = 1;
export const DEFAULT_TRUST_DOWNGRADE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h, "temporary"

export interface TrustDowngrade {
  requester: string;
  delta: number;
  issued_at: string;
  expires_at: string;
}

export interface RedFlagEvent {
  id: string;
  ts: string;
  requester: string;
  template_id: string | null;
  reason: TemplateRejectReason;
  received_text: string;
  classification: "hacked_or_malicious";
  trust_downgrade: TrustDowngrade;
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export interface EmitRedFlagInput {
  requester: string;
  templateId: string | null;
  reason: TemplateRejectReason;
  receivedText: string;
  now?: number;
  delta?: number;
  windowMs?: number;
}

/** Appends one red-flag event (never rewrites — append-only audit log, same
 * idiom as inventory-store/protocol's other JSONL stores). Returns the event
 * so the caller can fold it straight into a query trace. */
export function emitRedFlag(path: string, input: EmitRedFlagInput): RedFlagEvent {
  const now = input.now ?? Date.now();
  const delta = input.delta ?? DEFAULT_TRUST_DOWNGRADE_DELTA;
  const windowMs = input.windowMs ?? DEFAULT_TRUST_DOWNGRADE_WINDOW_MS;
  const event: RedFlagEvent = {
    id: randomUUID(),
    ts: new Date(now).toISOString(),
    requester: input.requester,
    template_id: input.templateId,
    reason: input.reason,
    received_text: input.receivedText,
    classification: "hacked_or_malicious",
    trust_downgrade: {
      requester: input.requester,
      delta,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + windowMs).toISOString(),
    },
  };
  ensureFile(path);
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return event;
}

/** Full local log, chronological (write order) — owner-side audit / inbox view. */
export function listRedFlags(path: string): RedFlagEvent[] {
  if (!existsSync(path)) return [];
  const out: RedFlagEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RedFlagEvent);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/** Sum of still-active (not yet expired at `now`) trust-downgrade deltas for
 * one requester. Purely additive/observational — multiple red flags in the
 * window stack, and every downgrade decays on its own regardless of later
 * ones (no reset-the-clock behavior, so a burst of bad queries reads as a
 * bigger, not longer, downgrade). */
export function activeTrustPenalty(path: string, requester: string, now: number = Date.now()): number {
  const nowIso = new Date(now).toISOString();
  return listRedFlags(path)
    .filter((e) => e.requester === requester && e.trust_downgrade.expires_at > nowIso)
    .reduce((sum, e) => sum + e.trust_downgrade.delta, 0);
}

/**
 * Applies an active trust penalty to a base RequesterPolicy: a
 * standing_allow requester with an unexpired red flag is downgraded to
 * ask_each_time until the flag decays — "surfaced in the owner UI/trace"
 * (memo) becomes teeth, not just a badge: the very next query from a
 * recently-flagged requester needs a fresh manual look even though they had
 * a standing grant. gate1/gate2 are left alone — Gate 0 is the "may this
 * requester query at all" gate, the right place to react to a fresh flag.
 */
export function effectivePolicy(base: RequesterPolicy, penalty: number): RequesterPolicy {
  if (penalty > 0 && base.gate0 === "standing_allow") {
    return { ...base, gate0: "ask_each_time" };
  }
  return base;
}
