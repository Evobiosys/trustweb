import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestRestorePromptFor, listRestorePrompts, recordRestorePrompt } from "./restore_prompt.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "restore-prompt-test-"));
  path = join(dir, "restore_prompts.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("recordRestorePrompt / listRestorePrompts", () => {
  it("records an event and reads it back", () => {
    const event = recordRestorePrompt(path, { redFlagId: "rf-1", requester: "ben@example.org" });
    expect(event.status).toBe("recorded");
    expect(listRestorePrompts(path)).toEqual([event]);
  });

  it("returns [] for a store that was never written", () => {
    expect(listRestorePrompts(join(dir, "never-written.jsonl"))).toEqual([]);
  });

  it("appends rather than overwrites across multiple calls", () => {
    recordRestorePrompt(path, { redFlagId: "rf-1", requester: "ben@example.org" });
    recordRestorePrompt(path, { redFlagId: "rf-2", requester: "cyn@example.org" });
    expect(listRestorePrompts(path)).toHaveLength(2);
  });

  it("skips a malformed line instead of throwing", () => {
    recordRestorePrompt(path, { redFlagId: "rf-1", requester: "ben@example.org" });
    appendFileSync(path, "not json\n");
    recordRestorePrompt(path, { redFlagId: "rf-2", requester: "cyn@example.org" });
    expect(listRestorePrompts(path)).toHaveLength(2);
  });
});

describe("latestRestorePromptFor", () => {
  it("returns undefined when no prompt was ever sent for that flag", () => {
    expect(latestRestorePromptFor([], "rf-1")).toBeUndefined();
  });

  it("returns the most recent event for the given red-flag id", () => {
    const older = recordRestorePrompt(path, { redFlagId: "rf-1", requester: "ben@example.org", now: 1_000 });
    const newer = recordRestorePrompt(path, { redFlagId: "rf-1", requester: "ben@example.org", now: 2_000 });
    recordRestorePrompt(path, { redFlagId: "rf-2", requester: "cyn@example.org", now: 3_000 });
    const events = listRestorePrompts(path);
    expect(latestRestorePromptFor(events, "rf-1")).toEqual(newer);
    expect(older.id).not.toBe(newer.id);
  });
});
