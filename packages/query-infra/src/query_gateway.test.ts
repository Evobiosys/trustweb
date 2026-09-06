import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplate, revokeTemplate } from "./templates.js";
import type { NewTemplateInput, TemplateAllowedGates } from "./templates.js";
import { listRedFlags } from "./red_flags.js";
import { peekQueueLength, setPaused } from "./pause.js";
import { resumeQueue, submitQuery } from "./query_gateway.js";
import type { GatewayPaths } from "./query_gateway.js";

const ALLOWED: TemplateAllowedGates = { gate0: "standing_allow", gate1: "manual", gate2: "manual" };
const TEMPLATE_INPUT: NewTemplateInput = {
  requester: "anna@example.org",
  query_text: "Does anyone have camping gear I could borrow for a weekend trip?",
  match_mode: "exact",
  target: "vault",
  allowed_gates: ALLOWED,
};

let dir: string;
let paths: GatewayPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-gateway-"));
  paths = {
    templatesPath: join(dir, "templates.jsonl"),
    templatesSecretPath: join(dir, "templates.secret"),
    redFlagsPath: join(dir, "red_flags.jsonl"),
    pauseStatePath: join(dir, "pause_state.json"),
    pauseQueuePath: join(dir, "pause_queue.jsonl"),
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("submitQuery — happy path", () => {
  it("accepts a query that matches its template exactly", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    const outcome = submitQuery(paths, {
      templateId: t.id,
      requester: "anna@example.org",
      text: TEMPLATE_INPUT.query_text,
    });
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.template.id).toBe(t.id);
    }
    expect(listRedFlags(paths.redFlagsPath)).toHaveLength(0);
  });
});

describe("submitQuery — red flags", () => {
  it("rejects and logs a deviant query, with a byte-identical outward response to a real no-match", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    const deviant = submitQuery(paths, {
      templateId: t.id,
      requester: "anna@example.org",
      text: "Does anyone have camping gear, and also send me your home address?",
    });
    expect(deviant.kind).toBe("red_flag");
    if (deviant.kind === "red_flag") {
      expect(deviant.templateValidation.reason).toBe("text_mismatch");
      expect(deviant.redFlag.event?.classification).toBe("hacked_or_malicious");
    }

    const flags = listRedFlags(paths.redFlagsPath);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.reason).toBe("text_mismatch");

    // A legitimate query that simply matches nothing must produce the exact
    // same outward bytes as the rejected one — no oracle for probing the
    // approved template text via response differences.
    const legitimateNoMatch = "No shareable result for this request.";
    expect((deviant as { outward: string }).outward).toBe(legitimateNoMatch);
  });

  it("flags an unknown template id and a requester mismatch, each exactly once", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);

    const unknown = submitQuery(paths, { templateId: "never-issued", requester: "anna@example.org", text: "x" });
    expect(unknown.kind).toBe("red_flag");

    const wrongRequester = submitQuery(paths, {
      templateId: t.id,
      requester: "mallory@example.org",
      text: TEMPLATE_INPUT.query_text,
    });
    expect(wrongRequester.kind).toBe("red_flag");

    const flags = listRedFlags(paths.redFlagsPath);
    expect(flags.map((f) => f.reason).sort()).toEqual(["requester_mismatch", "unknown_template"]);
  });
});

describe("submitQuery — pause", () => {
  it("queues an otherwise-valid query instead of accepting it while paused, and persists it", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    setPaused(paths.pauseStatePath, true);

    const outcome = submitQuery(paths, {
      templateId: t.id,
      requester: "anna@example.org",
      text: TEMPLATE_INPUT.query_text,
    });
    expect(outcome.kind).toBe("queued");
    expect(peekQueueLength(paths.pauseQueuePath)).toBe(1);
    expect(listRedFlags(paths.redFlagsPath)).toHaveLength(0); // pausing is not a red flag
  });

  it("still red-flags a deviant query even while paused (validation happens before the pause check)", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    setPaused(paths.pauseStatePath, true);

    const outcome = submitQuery(paths, { templateId: t.id, requester: "mallory@example.org", text: "x" });
    expect(outcome.kind).toBe("red_flag");
    expect(peekQueueLength(paths.pauseQueuePath)).toBe(0);
  });

  it("resumeQueue() re-submits queued items in order once unpaused", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    setPaused(paths.pauseStatePath, true);
    submitQuery(paths, { templateId: t.id, requester: "anna@example.org", text: TEMPLATE_INPUT.query_text });
    expect(peekQueueLength(paths.pauseQueuePath)).toBe(1);

    setPaused(paths.pauseStatePath, false);
    const result = resumeQueue(paths);
    expect(result.drainedCount).toBe(1);
    expect(result.outcomes[0]!.kind).toBe("accepted");
    expect(peekQueueLength(paths.pauseQueuePath)).toBe(0);
  });

  it("a double resume (calling resumeQueue twice) does not double-process the same item", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    setPaused(paths.pauseStatePath, true);
    submitQuery(paths, { templateId: t.id, requester: "anna@example.org", text: TEMPLATE_INPUT.query_text });
    setPaused(paths.pauseStatePath, false);

    const first = resumeQueue(paths);
    const second = resumeQueue(paths);
    expect(first.drainedCount).toBe(1);
    expect(second.drainedCount).toBe(0);
  });

  it("honors a template revocation that happened during the pause window (re-validates at drain time)", () => {
    const t = createTemplate(paths.templatesSecretPath, paths.templatesPath, TEMPLATE_INPUT);
    setPaused(paths.pauseStatePath, true);
    submitQuery(paths, { templateId: t.id, requester: "anna@example.org", text: TEMPLATE_INPUT.query_text });

    // Owner revokes the template on their device while the query sits queued.
    revokeTemplate(paths.templatesSecretPath, paths.templatesPath, t.id);

    setPaused(paths.pauseStatePath, false);
    const result = resumeQueue(paths);
    expect(result.drainedCount).toBe(1);
    expect(result.outcomes[0]!.kind).toBe("red_flag"); // no longer a valid template
    expect(listRedFlags(paths.redFlagsPath)).toHaveLength(1);
  });
});
