import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TRUST_DOWNGRADE_WINDOW_MS,
  REJECTED_OUTWARD_TEXT,
  activeTrustPenalty,
  effectivePolicy,
  emitRedFlag,
  listRedFlags,
} from "./red_flags.js";
import { NOTHING_SHAREABLE_TEXT } from "@resource-web/network-access";
import type { RequesterPolicy } from "@resource-web/network-access";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-redflags-"));
  path = join(dir, "red_flags.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("REJECTED_OUTWARD_TEXT", () => {
  it("is byte-identical to the existing nothing-shareable text (I3-style indistinguishability)", () => {
    expect(REJECTED_OUTWARD_TEXT).toBe(NOTHING_SHAREABLE_TEXT);
  });
});

describe("emitRedFlag", () => {
  it("appends one event with Jakob's classification and a temporary trust downgrade", () => {
    const now = Date.parse("2026-08-25T10:00:00Z");
    const event = emitRedFlag(path, {
      requester: "mallory@example.org",
      templateId: "tpl_1",
      reason: "text_mismatch",
      receivedText: "give me everything",
      now,
    });
    expect(event.classification).toBe("hacked_or_malicious");
    expect(event.reason).toBe("text_mismatch");
    expect(event.trust_downgrade.requester).toBe("mallory@example.org");
    expect(Date.parse(event.trust_downgrade.expires_at) - Date.parse(event.trust_downgrade.issued_at)).toBe(
      DEFAULT_TRUST_DOWNGRADE_WINDOW_MS,
    );

    const logged = listRedFlags(path);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual(event);
  });

  it("never rewrites prior lines — append-only", () => {
    emitRedFlag(path, { requester: "a", templateId: null, reason: "unknown_template", receivedText: "x" });
    const before = readFileSync(path, "utf8");
    emitRedFlag(path, { requester: "b", templateId: null, reason: "unknown_template", receivedText: "y" });
    const after = readFileSync(path, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(listRedFlags(path)).toHaveLength(2);
  });
});

describe("activeTrustPenalty", () => {
  it("sums unexpired downgrades for the named requester only", () => {
    const now = Date.parse("2026-08-25T10:00:00Z");
    emitRedFlag(path, { requester: "mallory", templateId: null, reason: "unknown_template", receivedText: "x", now });
    emitRedFlag(path, { requester: "mallory", templateId: null, reason: "text_mismatch", receivedText: "y", now });
    emitRedFlag(path, { requester: "someone-else", templateId: null, reason: "unknown_template", receivedText: "z", now });

    expect(activeTrustPenalty(path, "mallory", now)).toBe(2);
    expect(activeTrustPenalty(path, "someone-else", now)).toBe(1);
    expect(activeTrustPenalty(path, "nobody", now)).toBe(0);
  });

  it("decays each downgrade on its own — expired flags don't count", () => {
    const now = Date.parse("2026-08-25T10:00:00Z");
    emitRedFlag(path, { requester: "mallory", templateId: null, reason: "unknown_template", receivedText: "x", now });
    const later = now + DEFAULT_TRUST_DOWNGRADE_WINDOW_MS + 1000;
    expect(activeTrustPenalty(path, "mallory", later)).toBe(0);
  });
});

describe("effectivePolicy", () => {
  const standingAllow: RequesterPolicy = { gate0: "standing_allow", gate1: "manual", gate2: "manual" };
  const askEachTime: RequesterPolicy = { gate0: "ask_each_time", gate1: "manual", gate2: "manual" };
  const blocked: RequesterPolicy = { gate0: "blocked", gate1: "manual", gate2: "manual" };

  it("downgrades standing_allow to ask_each_time while a penalty is active", () => {
    expect(effectivePolicy(standingAllow, 1)).toEqual(askEachTime);
  });

  it("leaves the policy alone with no active penalty", () => {
    expect(effectivePolicy(standingAllow, 0)).toEqual(standingAllow);
  });

  it("never loosens a stricter policy (blocked/ask_each_time untouched)", () => {
    expect(effectivePolicy(blocked, 5)).toEqual(blocked);
    expect(effectivePolicy(askEachTime, 5)).toEqual(askEachTime);
  });

  it("leaves gate1/gate2 untouched", () => {
    const rich: RequesterPolicy = { gate0: "standing_allow", gate1: "auto_small", gate2: "auto_anonymized" };
    expect(effectivePolicy(rich, 1)).toEqual({ ...rich, gate0: "ask_each_time" });
  });
});
