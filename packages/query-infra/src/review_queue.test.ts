import { describe, expect, it } from "vitest";
import { buildReviewQueue, primaryActionFor, seasonLabel, staleness, STALE_AFTER_MS } from "./review_queue.js";
import type { PendingCardInput, QueueCardInput, RedFlagCardInput } from "./review_queue.js";

function pending(overrides: Partial<PendingCardInput>): PendingCardInput {
  return {
    kind: "pending",
    id: "q1",
    requester: "anna@example.org",
    text: "camping gear?",
    receivedAt: Date.now(),
    state: "awaiting_gate0",
    ...overrides,
  };
}

function redFlag(overrides: Partial<RedFlagCardInput>): RedFlagCardInput {
  return {
    kind: "red_flag",
    id: "rf1",
    requester: "ben@example.org",
    receivedText: "deviant text",
    ts: new Date().toISOString(),
    reason: "text_mismatch",
    trustDowngradeExpiresAt: new Date(Date.now() + 1000).toISOString(),
    ...overrides,
  };
}

describe("primaryActionFor", () => {
  it("offers allow/decline at awaiting_gate0", () => {
    expect(primaryActionFor("awaiting_gate0")).toEqual({ approve: "gate0_allow", decline: "gate0_block" });
  });

  it("offers only run at awaiting_run — gates.ts has no decline event there", () => {
    expect(primaryActionFor("awaiting_run")).toEqual({ approve: "run_small" });
  });

  it("offers anonymized-share/decline at awaiting_reveal", () => {
    expect(primaryActionFor("awaiting_reveal")).toEqual({ approve: "reveal_anonymized", decline: "decline_reveal" });
  });

  it("offers nothing for a terminal state", () => {
    expect(primaryActionFor("responded")).toEqual({ approve: null });
  });
});

describe("buildReviewQueue", () => {
  it("includes actionable pending states and excludes terminal ones", () => {
    const cards: QueueCardInput[] = [
      pending({ id: "a", state: "awaiting_gate0" }),
      pending({ id: "b", state: "running" }),
      pending({ id: "c", state: "responded" }),
      pending({ id: "d", state: "awaiting_reveal" }),
    ];
    const queue = buildReviewQueue(cards);
    expect(queue.map((c) => c.id).sort()).toEqual(["a", "d"]);
  });

  it("always includes red-flag cards, marked non-actionable", () => {
    const cards: QueueCardInput[] = [redFlag({ id: "rf" })];
    const queue = buildReviewQueue(cards);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.kind).toBe("red_flag");
    expect(queue[0]!.actionable).toBe(false);
  });

  it("marks restorePromptSent from restorePromptSentAt", () => {
    const withSent = buildReviewQueue([redFlag({ id: "rf", restorePromptSentAt: new Date().toISOString() })]);
    const withoutSent = buildReviewQueue([redFlag({ id: "rf2" })]);
    expect((withSent[0] as any).restorePromptSent).toBe(true);
    expect((withoutSent[0] as any).restorePromptSent).toBe(false);
  });

  it("orders newest first across both card kinds", () => {
    const now = Date.now();
    const cards: QueueCardInput[] = [
      pending({ id: "old", state: "awaiting_gate0", receivedAt: now - 10_000 }),
      redFlag({ id: "newest", ts: new Date(now).toISOString() }),
      pending({ id: "mid", state: "awaiting_gate0", receivedAt: now - 5_000 }),
    ];
    const queue = buildReviewQueue(cards);
    expect(queue.map((c) => c.id)).toEqual(["newest", "mid", "old"]);
  });

  it("attaches the template reference for a templated pending card, when present", () => {
    const queue = buildReviewQueue([
      pending({ id: "t", template: { id: "tmpl-1", target: "vault" } }),
    ]);
    expect((queue[0] as any).template).toEqual({ id: "tmpl-1", target: "vault" });
  });
});

describe("staleness / seasonLabel", () => {
  it("is not stale for a recent timestamp", () => {
    const now = Date.parse("2026-08-25T00:00:00Z");
    const result = staleness(now - 1000, now);
    expect(result.stale).toBe(false);
    expect(result.seasonNote).toBeUndefined();
  });

  it("flags stale past ~3 months and attaches a season note", () => {
    const now = Date.parse("2026-08-25T00:00:00Z");
    const then = now - STALE_AFTER_MS - 1000;
    const result = staleness(then, now);
    expect(result.stale).toBe(true);
    expect(result.seasonNote).toMatch(/verify still current/);
  });

  it("produces a human season/year label", () => {
    expect(seasonLabel(Date.parse("2026-08-05T00:00:00Z"))).toBe("early summer 2026");
    expect(seasonLabel(Date.parse("2026-01-20T00:00:00Z"))).toBe("mid winter 2026");
    expect(seasonLabel(Date.parse("2026-11-28T00:00:00Z"))).toBe("late autumn 2026");
  });

  it("never reports negative age for a future timestamp (clock skew guard)", () => {
    const now = Date.now();
    expect(staleness(now + 10_000, now).ageMs).toBe(0);
  });
});
