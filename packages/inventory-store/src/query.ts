// Query path + transparent trace (handover addendum, not in the base spec).
// Matches over currentView() ONLY — never transcripts, never raw files
// elsewhere. Zero-dep keyword scoring: no LLM required.
import { currentView } from "./store.js";
import type { InventoryRecord } from "./types.js";

// Named INVENTORY_DEFAULT_K, not DEFAULT_K, so it can never be mistaken for
// (or grep-collide with) the canonical k-anonymity floor exported by
// packages/network-access/src/anonymity.ts's DEFAULT_K -- currently
// value-equal (3) but NOT imported from it: inventory-store deliberately
// declares zero dependencies in its own package.json (decision B-22's
// AGPL/third-party-dependency audit relied on that fact), while
// network-access is licensed AGPL-3.0-or-later. Wiring one to import the
// other is a dependency/license call for the project owner, not made here.
// apps/demo/test/k_cross_package_sync.test.ts is the structural guard: it
// imports both constants and fails the moment they diverge, so drift breaks
// a test instead of going unnoticed. See docs/k-parameters.md's k1 section.
export const INVENTORY_DEFAULT_K = 3;

// Byte-identical outward text for suppressed AND zero-match cases, mirroring
// packages/network-access's anonymity.ts convention: a distinguishable
// suppressed response would itself leak "between 1 and k-1 people match".
export const NOTHING_SHAREABLE_TEXT = "No shareable result for this request.";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "for",
  "to",
  "of",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "with",
  "from",
  "by",
  "it",
  "this",
  "that",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "they",
  "them",
  "do",
  "does",
  "did",
  "as",
  "if",
  "so",
  "but",
  "not",
]);

const MONTH_ALIASES: Record<string, string> = {
  january: "jan",
  february: "feb",
  march: "mar",
  april: "apr",
  june: "jun",
  july: "jul",
  august: "aug",
  september: "sep",
  sept: "sep",
  october: "oct",
  november: "nov",
  december: "dec",
};

// Normalize a single token: lowercase, collapse full month names to their
// 3-letter abbreviation so "july" matches "Jul" in an availability_note.
function normalizeToken(token: string): string {
  const lower = token.toLowerCase();
  return MONTH_ALIASES[lower] ?? lower;
}

// Lowercase, strip punctuation (replaced by whitespace), tokenize, normalize.
function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(normalizeToken);
}

function queryTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// All searchable text on a record, including availability_note/description
// explicitly per the handover's "also match month-name/date tokens against
// availability_note/description" — those two fields are already part of the
// general haystack below, so date/month tokens normalized the same way match
// them without special-casing.
function haystackTokens(record: InventoryRecord): Set<string> {
  const text = [
    record.name,
    record.description,
    record.category,
    record.location ?? "",
    record.availability_note ?? "",
    record.note ?? "",
    record.tags.join(" "),
  ].join(" ");
  return new Set(tokenize(text));
}

export interface Candidate {
  id: string;
  matched_terms: string[];
  score: number;
}

export interface KDecision {
  sharing_count: number;
  total: number;
  k: number;
  released: boolean;
  line: string;
}

export interface QueryTrace {
  query: { text: string; requester: string; gate_states: Record<string, unknown> };
  scanned: { count: number; ids: string[] };
  candidates: Candidate[];
  k_decision: KDecision;
  outward: { bytes: string };
}

export interface RunQueryOptions {
  text: string;
  requester: string;
  gates?: Record<string, unknown>;
  k?: number; // override the k-anonymity floor (default INVENTORY_DEFAULT_K)
}

function scoreRecord(qTokens: string[], record: InventoryRecord): Candidate {
  const hay = haystackTokens(record);
  const matched = qTokens.filter((t) => hay.has(t));
  return { id: record.id, matched_terms: matched, score: matched.length };
}

function kDecisionLine(sharingCount: number, total: number, k: number, released: boolean): string {
  const gate = released ? `meets k=${k}` : `below k=${k}`;
  const outcome = released ? "released" : "suppressed";
  return `${sharingCount} of ${total} sharing → ${gate} → ${outcome}`;
}

export async function runQuery(path: string, options: RunQueryOptions): Promise<QueryTrace> {
  const { text, requester, gates = {}, k = INVENTORY_DEFAULT_K } = options;
  const records = await currentView(path);
  const qTokens = queryTokens(text);

  const scanned = { count: records.length, ids: records.map((r) => r.id) };

  const candidates = records
    .map((r) => scoreRecord(qTokens, r))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const sharingCount = candidates.length;
  const total = records.length;
  const released = sharingCount >= k && sharingCount > 0;
  const line = kDecisionLine(sharingCount, total, k, released);

  const outwardBytes = released
    ? `${sharingCount} of ${total} people in this network are sharing what you asked about.`
    : NOTHING_SHAREABLE_TEXT;

  return {
    query: { text, requester, gate_states: gates },
    scanned,
    candidates,
    k_decision: { sharing_count: sharingCount, total, k, released, line },
    outward: { bytes: outwardBytes },
  };
}
