import { describe, expect, it } from "vitest";
import { ReplySchedule, releaseAtForTick } from "./reply_schedule.js";

describe("releaseAtForTick", () => {
  it("releases at the next tick boundary at or after decisionReadyAt", () => {
    expect(releaseAtForTick(1, 30_000, 0)).toBe(30_000);
    expect(releaseAtForTick(29_999, 30_000, 0)).toBe(30_000);
    expect(releaseAtForTick(30_000, 30_000, 0)).toBe(30_000);
    expect(releaseAtForTick(30_001, 30_000, 0)).toBe(60_000);
  });

  it("a 2s decision and a 28s decision in the same 30s window release at the identical tick", () => {
    const fastApprove = releaseAtForTick(2_000, 30_000, 0);
    const slowDecline = releaseAtForTick(28_000, 30_000, 0);
    expect(fastApprove).toBe(slowDecline);
    expect(fastApprove).toBe(30_000);
  });

  it("honors a non-zero epoch", () => {
    expect(releaseAtForTick(100_005, 30_000, 100_000)).toBe(130_000);
  });

  it("rejects a non-positive tick interval", () => {
    expect(() => releaseAtForTick(1, 0)).toThrow(RangeError);
    expect(() => releaseAtForTick(1, -5)).toThrow(RangeError);
  });
});

describe("ReplySchedule", () => {
  it("buckets payloads by tick and releases only what is due", () => {
    const schedule = new ReplySchedule<string>(30_000, 0);
    schedule.enqueue("fast-approve", 2_000);
    schedule.enqueue("slow-decline", 28_000);
    schedule.enqueue("next-window", 31_000);

    expect(schedule.due(29_999)).toEqual([]);
    expect(schedule.size).toBe(3);

    const firstTick = schedule.due(30_000);
    expect(firstTick.sort()).toEqual(["fast-approve", "slow-decline"]);
    expect(schedule.size).toBe(1);

    const secondTick = schedule.due(60_000);
    expect(secondTick).toEqual(["next-window"]);
    expect(schedule.size).toBe(0);
  });

  it("byte-identical suppressed/no-result payloads pass through untouched — the scheduler only affects timing", () => {
    const suppressed = { kind: "declined", text: "No shareable result for this request." };
    const schedule = new ReplySchedule<typeof suppressed>(30_000, 0);
    schedule.enqueue(suppressed, 5_000);
    const [released] = schedule.due(30_000);
    expect(released).toEqual(suppressed);
    expect(released).toBe(suppressed); // same object identity — payload is opaque, never mutated
  });

  it("enqueue returns the computed release tick", () => {
    const schedule = new ReplySchedule<string>(30_000, 0);
    expect(schedule.enqueue("x", 15_000)).toBe(30_000);
  });
});
