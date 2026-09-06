// Pre-approved query templates (Jakob's 2026-08-25 memo, item 1): a signed
// whitelist per requester — "only THIS query is fine to run, and only from
// THIS person." An incoming query is only ever answered if it references an
// existing template id AND the requester + text match what that template
// approved (see validateAgainstTemplate). Any change to a template — create
// or revoke — happens ONLY on the data-owner's device, through the functions
// in this file writing the owner's local store; nothing an incoming request
// carries can create or edit a template, only reference one by id.
//
// Storage mirrors inventory-store's append-only JSONL + Graffiti-style
// supersession (never rewrite a line in place; revoke = append a superseding
// record with revoked:true). Signing mirrors protocol/envelope.ts's
// canonical-JSON approach (duplicated here, not imported — a cross-package
// import would need a workspace relink/install, which this task forbids).
//
// "Signed" means: only code holding the local secret (query_templates.secret,
// mode 0600, generated on first use, never logged) can produce a template
// record this store will treat as valid. Hand-editing a JSONL line without
// re-signing it makes that record fail verification — currentView() then
// treats it as a distinct "tampered" case (see validateAgainstTemplate),
// not a silent no-op.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { Gate0Policy, Gate1Policy, Gate2Policy } from "@resource-web/network-access";

export class TemplateError extends Error {}
export class UnknownTemplateSecretError extends TemplateError {}

export type MatchMode = "exact" | "contains";
export type TemplateTarget = "network" | "vault";

export interface TemplateAllowedGates {
  gate0: Gate0Policy;
  gate1: Gate1Policy;
  gate2: Gate2Policy;
}

/** One pre-approved (requester, query) pair. `sig` covers every other field
 * below via canonical JSON + HMAC-SHA256 (see sign()/verify()). */
export interface QueryTemplate {
  id: string;
  requester: string;
  query_text: string;
  match_mode: MatchMode;
  target: TemplateTarget;
  allowed_gates: TemplateAllowedGates;
  created_at: string;
  /** Graffiti-style supersession: set on the record that replaces an older
   * one (e.g. a revocation). null on an original template. */
  supersedes: string | null;
  revoked: boolean;
  sig: string;
}

export type NewTemplateInput = {
  requester: string;
  query_text: string;
  match_mode: MatchMode;
  target: TemplateTarget;
  allowed_gates: TemplateAllowedGates;
};

const MATCH_MODES: MatchMode[] = ["exact", "contains"];
const TARGETS: TemplateTarget[] = ["network", "vault"];
const GATE0: Gate0Policy[] = ["blocked", "ask_each_time", "standing_allow"];
const GATE1: Gate1Policy[] = ["manual", "auto_small"];
const GATE2: Gate2Policy[] = ["manual", "auto_anonymized", "auto_reveal_identity"];

function assertNewTemplateInput(input: NewTemplateInput): void {
  if (!input.requester.trim()) throw new TemplateError("template requester must be non-empty");
  if (!input.query_text.trim()) throw new TemplateError("template query_text must be non-empty");
  if (!MATCH_MODES.includes(input.match_mode)) {
    throw new TemplateError(`unknown match_mode "${input.match_mode}"`);
  }
  if (!TARGETS.includes(input.target)) throw new TemplateError(`unknown target "${input.target}"`);
  if (!GATE0.includes(input.allowed_gates.gate0)) {
    throw new TemplateError(`unknown allowed_gates.gate0 "${input.allowed_gates.gate0}"`);
  }
  if (!GATE1.includes(input.allowed_gates.gate1)) {
    throw new TemplateError(`unknown allowed_gates.gate1 "${input.allowed_gates.gate1}"`);
  }
  if (!GATE2.includes(input.allowed_gates.gate2)) {
    throw new TemplateError(`unknown allowed_gates.gate2 "${input.allowed_gates.gate2}"`);
  }
}

/** Deterministic deep-key-sorted JSON stringify, mirroring
 * protocol/envelope.ts's canonicalize() — duplicated locally (see file
 * header) so two structurally-equal records always sign/verify the same. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Every field except `sig` itself is covered by the signature. */
function signableFields(t: Omit<QueryTemplate, "sig">): unknown {
  return canonicalize(t);
}

/** Loads (or, on first use, generates) the local device secret used to sign
 * and verify templates. 32 random bytes, written with mode 0600, never
 * logged. This IS the "only the owner's device can approve a template"
 * property — no key material ever leaves this file. */
export function loadOrCreateSecret(secretPath: string): Buffer {
  if (existsSync(secretPath)) return readFileSync(secretPath);
  mkdirSync(dirname(secretPath), { recursive: true });
  const secret = randomBytes(32);
  writeFileSync(secretPath, secret, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  return secret;
}

function sign(secret: Buffer, t: Omit<QueryTemplate, "sig">): string {
  return createHmac("sha256", secret).update(JSON.stringify(signableFields(t))).digest("hex");
}

/** Constant-time signature check. */
export function verify(secret: Buffer, t: QueryTemplate): boolean {
  const { sig, ...rest } = t;
  const expected = sign(secret, rest);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "");
}

/** Raw lines in file (write/chronological) order, including superseded and
 * revoked records — the full audit trail. Malformed lines are skipped
 * (never thrown on) so one bad line can't take down the whole store. */
export function listAllRaw(path: string): QueryTemplate[] {
  if (!existsSync(path)) return [];
  const out: QueryTemplate[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as QueryTemplate);
    } catch {
      // skip malformed line — audit-trail read stays best-effort
    }
  }
  return out;
}

/** Latest-wins, signature-verified, non-revoked templates only — the set an
 * incoming query may actually reference. A record whose signature fails
 * verification (hand-edited outside this module) is excluded here even
 * though it still appears in listAllRaw(); validateAgainstTemplate() uses
 * that difference to distinguish "tampered" from "never existed". */
export function currentView(path: string, secret: Buffer): QueryTemplate[] {
  const all = listAllRaw(path);
  const byId = new Map<string, QueryTemplate>();
  const superseded = new Set<string>();
  for (const t of all) {
    byId.set(t.id, t);
    if (t.supersedes) superseded.add(t.supersedes);
  }
  return [...byId.values()].filter(
    (t) => !superseded.has(t.id) && !t.revoked && verify(secret, t),
  );
}

/** Creates and appends a new, signed template. Only ever called from the
 * owner's own device-side code path (the demo server's owner-facing
 * endpoints) — never in response to anything an incoming request supplies
 * beyond a template id reference. */
export function createTemplate(
  secretPath: string,
  storePath: string,
  input: NewTemplateInput,
): QueryTemplate {
  assertNewTemplateInput(input);
  const secret = loadOrCreateSecret(secretPath);
  const unsigned: Omit<QueryTemplate, "sig"> = {
    id: randomUUID(),
    requester: input.requester,
    query_text: input.query_text,
    match_mode: input.match_mode,
    target: input.target,
    allowed_gates: input.allowed_gates,
    created_at: new Date().toISOString(),
    supersedes: null,
    revoked: false,
  };
  const record: QueryTemplate = { ...unsigned, sig: sign(secret, unsigned) };
  ensureFile(storePath);
  appendFileSync(storePath, `${JSON.stringify(record)}\n`);
  return record;
}

/** Revokes a template by appending a superseding record with revoked:true —
 * never rewrites the original line (append-only, Graffiti-style, matching
 * inventory-store's supersede() idiom). Throws if the id is unknown or
 * already superseded. */
export function revokeTemplate(secretPath: string, storePath: string, id: string): QueryTemplate {
  const secret = loadOrCreateSecret(secretPath);
  const live = currentView(storePath, secret);
  const head = live.find((t) => t.id === id);
  if (!head) throw new TemplateError(`template ${id} is not a current, valid template`);
  const unsigned: Omit<QueryTemplate, "sig"> = {
    ...head,
    id: randomUUID(),
    created_at: new Date().toISOString(),
    supersedes: id,
    revoked: true,
  };
  const record: QueryTemplate = { ...unsigned, sig: sign(secret, unsigned) };
  appendFileSync(storePath, `${JSON.stringify(record)}\n`);
  return record;
}

export type TemplateRejectReason =
  | "unknown_template"
  | "tampered_template"
  | "requester_mismatch"
  | "text_mismatch";

export type TemplateValidationResult =
  | { ok: true; template: QueryTemplate }
  | { ok: false; reason: TemplateRejectReason };

/** Lowercase + collapse whitespace, matching contact_matcher.ts's
 * normalizeText spirit (avoids false red-flags on capitalization/punctuation
 * differences alone) without pulling in its diacritic stripping — template
 * text is compared for a real match, not fuzzy-searched. NFC-normalizes
 * first: visually identical text can arrive as different Unicode byte
 * sequences (composed vs. decomposed accents) — without this, a real
 * legitimate requester could get silently red-flagged (with a 24h trust
 * downgrade) over a difference invisible to both parties. */
function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Validates an incoming query against the owner's local template store.
 * `raw` is listAllRaw()'s output (every record ever written, for tamper
 * detection); `valid` is currentView()'s output (what's actually usable).
 * Never both-null-and-empty by construction — callers pass the same path's
 * two views.
 */
export function validateAgainstTemplate(
  raw: QueryTemplate[],
  valid: QueryTemplate[],
  input: { templateId: string; requester: string; text: string },
): TemplateValidationResult {
  const rawMatch = raw.find((t) => t.id === input.templateId);
  if (!rawMatch) return { ok: false, reason: "unknown_template" };

  const validMatch = valid.find((t) => t.id === input.templateId);
  if (!validMatch) {
    // Exists in the raw log but not in the verified/live set: either its
    // signature no longer checks out (hand-edited) or it's since been
    // superseded/revoked. Superseded chains resolve to the newest id, which
    // the requester was never given — from their side that's just as
    // "unknown" as an id that never existed, so only a genuine signature
    // failure on this exact record gets the sharper "tampered" label.
    const superseded = raw.some((t) => t.supersedes === rawMatch.id);
    if (superseded || rawMatch.revoked) return { ok: false, reason: "unknown_template" };
    return { ok: false, reason: "tampered_template" };
  }

  if (normalize(validMatch.requester) !== normalize(input.requester)) {
    return { ok: false, reason: "requester_mismatch" };
  }

  const approved = normalize(validMatch.query_text);
  const incoming = normalize(input.text);
  const textOk = validMatch.match_mode === "exact" ? approved === incoming : incoming.includes(approved);
  if (!textOk) return { ok: false, reason: "text_mismatch" };

  return { ok: true, template: validMatch };
}
