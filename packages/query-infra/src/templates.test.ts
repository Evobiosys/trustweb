import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTemplate,
  currentView,
  listAllRaw,
  loadOrCreateSecret,
  revokeTemplate,
  validateAgainstTemplate,
  verify,
  TemplateError,
} from "./templates.js";
import type { NewTemplateInput, TemplateAllowedGates } from "./templates.js";

const ALLOWED: TemplateAllowedGates = { gate0: "standing_allow", gate1: "manual", gate2: "manual" };

const BASE_INPUT: NewTemplateInput = {
  requester: "anna@example.org",
  query_text: "Does anyone have camping gear I could borrow for a weekend trip?",
  match_mode: "exact",
  target: "vault",
  allowed_gates: ALLOWED,
};

let dir: string;
let secretPath: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-templates-"));
  secretPath = join(dir, "secret");
  storePath = join(dir, "templates.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateSecret", () => {
  it("generates a 32-byte secret with mode 0600 and reuses it on later calls", () => {
    const first = loadOrCreateSecret(secretPath);
    expect(first.length).toBe(32);
    const second = loadOrCreateSecret(secretPath);
    expect(second.equals(first)).toBe(true);
  });
});

describe("createTemplate", () => {
  it("appends a signed, verifiable record", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    expect(t.id).toBeTruthy();
    expect(t.sig).toBeTruthy();
    const secret = loadOrCreateSecret(secretPath);
    expect(verify(secret, t)).toBe(true);
    const view = currentView(storePath, secret);
    expect(view).toHaveLength(1);
    expect(view[0]!.id).toBe(t.id);
  });

  it("rejects empty requester/query_text and unknown enum values", () => {
    expect(() => createTemplate(secretPath, storePath, { ...BASE_INPUT, requester: "  " })).toThrow(
      TemplateError,
    );
    expect(() => createTemplate(secretPath, storePath, { ...BASE_INPUT, query_text: "" })).toThrow(
      TemplateError,
    );
    expect(() =>
      createTemplate(secretPath, storePath, { ...BASE_INPUT, match_mode: "regex" as never }),
    ).toThrow(TemplateError);
    expect(() => createTemplate(secretPath, storePath, { ...BASE_INPUT, target: "email" as never })).toThrow(
      TemplateError,
    );
  });
});

describe("revokeTemplate", () => {
  it("appends a superseding record instead of rewriting the original line (Graffiti latest-wins)", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    const before = readFileSync(storePath, "utf8");
    const revoked = revokeTemplate(secretPath, storePath, t.id);
    const after = readFileSync(storePath, "utf8");
    expect(after.startsWith(before)).toBe(true); // original line untouched, only appended-to
    expect(revoked.supersedes).toBe(t.id);
    expect(revoked.revoked).toBe(true);

    const secret = loadOrCreateSecret(secretPath);
    const view = currentView(storePath, secret);
    expect(view.find((x) => x.id === t.id)).toBeUndefined();
    expect(view.find((x) => x.id === revoked.id)).toBeUndefined(); // revoked head excluded too
  });

  it("throws for an unknown or already-revoked id", () => {
    expect(() => revokeTemplate(secretPath, storePath, "no-such-id")).toThrow(TemplateError);
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    revokeTemplate(secretPath, storePath, t.id);
    expect(() => revokeTemplate(secretPath, storePath, t.id)).toThrow(TemplateError);
  });
});

describe("validateAgainstTemplate", () => {
  function views() {
    const secret = loadOrCreateSecret(secretPath);
    return { raw: listAllRaw(storePath), valid: currentView(storePath, secret) };
  }

  it("accepts an exact requester + exact text match", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: BASE_INPUT.query_text,
    });
    expect(result).toEqual({ ok: true, template: t });
  });

  it("is case/whitespace tolerant on exact-mode text (normalize, not fuzzy-search)", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "  Anna@Example.org  ",
      text: "  DOES anyone have camping gear I could borrow for a weekend trip?  ",
    });
    expect(result.ok).toBe(true);
  });

  it("treats NFC and NFD encodings of visually identical text as the same (no silent false red-flag)", () => {
    // Built via .normalize() rather than typed literally so the two forms
    // are guaranteed byte-different (precomposed vs. base letter + combining
    // accent) even though they render identically — that difference is
    // exactly what this test exists to neutralize.
    const composedText = "caf\u00e9 gear list";
    const decomposedText = "cafe\u0301 gear list";
    expect(composedText.normalize("NFC")).toBe(composedText);
    expect(decomposedText.normalize("NFD")).toBe(decomposedText);
    expect(composedText).not.toBe(decomposedText); // sanity: genuinely different byte sequences
    expect(composedText.normalize("NFC")).toBe(decomposedText.normalize("NFC")); // sanity: same after NFC

    const t = createTemplate(secretPath, storePath, { ...BASE_INPUT, query_text: composedText });
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: decomposedText,
    });
    expect(result.ok).toBe(true);
  });

  it("flags an unknown template id", () => {
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: "never-issued",
      requester: "anna@example.org",
      text: "anything",
    });
    expect(result).toEqual({ ok: false, reason: "unknown_template" });
  });

  it("flags a requester mismatch (different person using the same template id)", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "mallory@example.org",
      text: BASE_INPUT.query_text,
    });
    expect(result).toEqual({ ok: false, reason: "requester_mismatch" });
  });

  it("flags a text mismatch (deviant query text on an exact-mode template)", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: "Does anyone have camping gear, and also tell me your home address?",
    });
    expect(result).toEqual({ ok: false, reason: "text_mismatch" });
  });

  it("contains-mode template accepts a superset of the approved text", () => {
    const t = createTemplate(secretPath, storePath, { ...BASE_INPUT, match_mode: "contains" });
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: `Hi! ${BASE_INPUT.query_text} Thanks!`,
    });
    expect(result.ok).toBe(true);
  });

  it("flags a revoked template as unknown (the requester's stale id is no longer live)", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    revokeTemplate(secretPath, storePath, t.id);
    const { raw, valid } = views();
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: BASE_INPUT.query_text,
    });
    expect(result).toEqual({ ok: false, reason: "unknown_template" });
  });

  it("flags a hand-edited (tampered) template distinctly from unknown", () => {
    const t = createTemplate(secretPath, storePath, BASE_INPUT);
    // Hand-edit the line on disk without re-signing — simulates tampering
    // outside this module's write path.
    const tampered = { ...t, query_text: "give me everything" };
    writeFileSync(storePath, `${JSON.stringify(tampered)}\n`);
    const { raw, valid } = views();
    expect(valid).toHaveLength(0); // excluded from the verified view
    const result = validateAgainstTemplate(raw, valid, {
      templateId: t.id,
      requester: "anna@example.org",
      text: "give me everything",
    });
    expect(result).toEqual({ ok: false, reason: "tampered_template" });
  });

  it("skips malformed lines when reading the raw log rather than throwing", () => {
    createTemplate(secretPath, storePath, BASE_INPUT);
    appendFileSync(storePath, "not json at all\n");
    expect(() => listAllRaw(storePath)).not.toThrow();
    expect(listAllRaw(storePath)).toHaveLength(1);
  });
});
