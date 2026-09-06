import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drain, enqueue, isPaused, peekQueueLength, readPauseState, setPaused } from "./pause.js";
import type { QueuedItem } from "./pause.js";

let dir: string;
let statePath: string;
let queuePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-pause-"));
  statePath = join(dir, "pause_state.json");
  queuePath = join(dir, "pause_queue.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("pause state", () => {
  it("defaults to not paused when no state file exists yet", () => {
    expect(isPaused(statePath)).toBe(false);
    expect(readPauseState(statePath)).toEqual({ paused: false, since: null });
  });

  it("pause() then resume() flip the flag and record `since`", () => {
    const paused = setPaused(statePath, true, Date.parse("2026-08-25T10:00:00Z"));
    expect(paused.paused).toBe(true);
    expect(paused.since).toBe("2026-08-25T10:00:00.000Z");
    expect(isPaused(statePath)).toBe(true);

    const resumed = setPaused(statePath, false, Date.parse("2026-08-25T10:05:00Z"));
    expect(resumed.paused).toBe(false);
    expect(isPaused(statePath)).toBe(false);
  });

  it("writes atomically (no .tmp file left behind after a write)", () => {
    setPaused(statePath, true);
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
    expect(existsSync(statePath)).toBe(true);
  });
});

describe("queue persistence", () => {
  interface Payload {
    text: string;
  }

  it("enqueue() persists items across separate reads (survives a process restart)", () => {
    enqueue<Payload>(queuePath, { id: "q1", enqueued_at: "2026-08-25T10:00:00Z", payload: { text: "a" } });
    enqueue<Payload>(queuePath, { id: "q2", enqueued_at: "2026-08-25T10:01:00Z", payload: { text: "b" } });
    expect(peekQueueLength(queuePath)).toBe(2);

    // A second "process" reading the same path sees both items.
    const items = drain<Payload>(queuePath);
    expect(items.map((i) => i.id)).toEqual(["q1", "q2"]);
  });

  it("drain() empties the queue and a double-drain (double-resume) returns nothing the second time", () => {
    enqueue<Payload>(queuePath, { id: "q1", enqueued_at: "2026-08-25T10:00:00Z", payload: { text: "a" } });
    const first = drain<Payload>(queuePath);
    expect(first).toHaveLength(1);
    const second = drain<Payload>(queuePath);
    expect(second).toHaveLength(0);
    expect(peekQueueLength(queuePath)).toBe(0);
  });

  it("drain() on a queue that was never written returns []", () => {
    expect(drain(queuePath)).toEqual([]);
  });

  it("drain() writes atomically (no .tmp file left behind)", () => {
    enqueue(queuePath, { id: "q1", enqueued_at: "now", payload: {} });
    drain(queuePath);
    expect(existsSync(`${queuePath}.tmp`)).toBe(false);
  });

  it("skips a malformed queue line rather than throwing", () => {
    enqueue<Payload>(queuePath, { id: "q1", enqueued_at: "2026-08-25T10:00:00Z", payload: { text: "a" } });
    // Corrupt append, simulating a torn write.
    appendFileSync(queuePath, "not json\n");
    let items: QueuedItem<Payload>[] = [];
    expect(() => {
      items = drain<Payload>(queuePath);
    }).not.toThrow();
    expect(items).toHaveLength(1);
  });
});
