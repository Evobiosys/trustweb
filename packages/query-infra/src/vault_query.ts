// Matching + transparent trace over a local markdown vault (memo item 4),
// mirroring inventory-store/src/query.ts's trace shape (scanned/candidates/
// k_decision/outward) and network-access's own k-anonymity convention
// (anonymity.ts) so a vault query is auditable the same way a network-access
// query already is. Matching goes through the strongest local model
// configured — reuses contact_matcher.ts's ChatClient/OllamaChatClient
// interfaces (same package, safe to import) rather than duplicating Ollama
// plumbing — with a deterministic keyword fallback so everything still
// works, and tests still pass, with no LLM reachable at all (matcher-chain
// philosophy, same as LlmContactMatcher).
import { DEFAULT_K, type ChatClient } from "@resource-web/network-access";
import type { VaultNote } from "./vault.js";

// The vault target is a different query surface but the same k-anonymity
// convention, so it reads the one floor rather than declaring a second one.
// The fork carried a vault-specific default of 7 here; that duplicate was
// deleted when this package was ported into the trunk (B-03 option A), and
// every call now resolves the single DEFAULT_K exported by
// @resource-web/network-access.
export const VAULT_NOTHING_SHAREABLE_TEXT = "No shareable result for this request.";

const STOPWORDS = new Set([
  "a", "an", "the", "to", "in", "for", "who", "with", "and", "or", "of", "on",
  "is", "are", "was", "were", "be", "from", "by", "it", "this", "that", "i",
  "me", "my", "we", "our", "you", "your", "does", "do", "did", "has", "have",
  "someone", "somebody", "anyone", "anybody", "can", "could",
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export interface VaultCandidate {
  id: string;
  title: string;
  matched_terms: string[];
  score: number;
}

export interface VaultMatcher {
  match(queryText: string, notes: VaultNote[]): Promise<VaultCandidate[]>;
}

/** Zero-dependency keyword overlap scorer — the guaranteed-available path. */
export class KeywordVaultMatcher implements VaultMatcher {
  constructor(private readonly minOverlap: number = 1) {}

  async match(queryText: string, notes: VaultNote[]): Promise<VaultCandidate[]> {
    const queryTokens = tokenSet(queryText);
    const results: VaultCandidate[] = [];
    for (const note of notes) {
      const haystack = tokenSet([note.title, note.body].join(" "));
      const overlap = [...queryTokens].filter((t) => haystack.has(t));
      if (overlap.length >= this.minOverlap) {
        results.push({
          id: note.id,
          title: note.title,
          matched_terms: overlap,
          score: overlap.length / Math.max(queryTokens.size, 1),
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

const LLM_SYSTEM_PROMPT = [
  "You match a request against a private set of personal notes.",
  'Answer ONLY with JSON: {"matches":[{"id":"...","reason":"..."}]}.',
  "Include a note only if it plausibly answers the request. Reasons stay under 12 words.",
].join(" ");

/** Tolerate models that wrap JSON in prose, code fences, or <think> blocks
 * (duplicated from contact_matcher.ts's private extractJson — small enough
 * to keep local rather than exporting a helper across an unrelated matcher's
 * module for one call site). */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return cleaned.slice(start, end + 1);
}

/** LLM-backed matcher over vault notes; falls back to `fallback` (normally a
 * KeywordVaultMatcher) on any failure — unreachable Ollama, missing model,
 * malformed JSON, unknown ids. Never throws. */
export class LlmVaultMatcher implements VaultMatcher {
  constructor(
    private readonly chatClient: ChatClient,
    private readonly model: string,
    private readonly fallback: VaultMatcher,
  ) {}

  async match(queryText: string, notes: VaultNote[]): Promise<VaultCandidate[]> {
    try {
      const listing = notes.map((n) => `${n.id}: ${n.title}\n${n.body}`).join("\n---\n");
      const raw = await this.chatClient.chat(this.model, [
        { role: "system", content: LLM_SYSTEM_PROMPT },
        { role: "user", content: `Request: ${queryText}\n\nNotes:\n${listing}` },
      ]);
      const parsed = JSON.parse(extractJson(raw)) as { matches?: { id?: string; reason?: string }[] };
      if (!Array.isArray(parsed.matches)) throw new Error("no matches array");
      const byId = new Map(notes.map((n) => [n.id, n]));
      return parsed.matches
        .filter((m): m is { id: string; reason?: string } => typeof m.id === "string" && byId.has(m.id))
        .map((m) => ({
          id: m.id,
          title: byId.get(m.id)!.title,
          matched_terms: [m.reason ?? "LLM match"],
          score: 1,
        }));
    } catch {
      return this.fallback.match(queryText, notes);
    }
  }
}

export interface VaultKDecision {
  sharing_count: number;
  total: number;
  k: number;
  released: boolean;
  line: string;
}

export interface VaultQueryTrace {
  query: { text: string; requester: string; gate_states: Record<string, unknown> };
  scanned: { count: number; ids: string[] };
  candidates: VaultCandidate[];
  k_decision: VaultKDecision;
  outward: { bytes: string };
}

export interface RunVaultQueryOptions {
  text: string;
  requester: string;
  k?: number;
  /** Mirrors inventory-store/src/query.ts's QueryTrace shape (requirement 5,
   * bullet 1: "query text + requester + gate states"). For a templated
   * query, the caller passes the template's allowed_gates — for a vault
   * query there's no Gate-0/1/2 ladder of its own, so this is "what gate
   * policy let this query run at all", not a state machine of its own. */
  gateStates?: Record<string, unknown>;
}

function kDecisionLine(sharingCount: number, total: number, k: number, released: boolean): string {
  const gate = released ? `meets k=${k}` : `below k=${k}`;
  const outcome = released ? "released" : "suppressed";
  return `${sharingCount} of ${total} sharing → ${gate} → ${outcome}`;
}

/** Runs one query over `notes` through `matcher`, returning the same kind of
 * transparent trace network-access already shows for network-intro queries:
 * how many notes were scanned (and their ids), per-candidate evidence, the
 * k-anonymity decision with its numbers, and the exact outward bytes. Below
 * k (or zero matches) the outward text is byte-identical to the "nothing
 * shareable" case — same convention as anonymity.ts. */
export async function runVaultQuery(
  notes: VaultNote[],
  matcher: VaultMatcher,
  options: RunVaultQueryOptions,
): Promise<VaultQueryTrace> {
  const { text, requester, k = DEFAULT_K, gateStates = {} } = options;
  const scanned = { count: notes.length, ids: notes.map((n) => n.id) };
  const candidates = await matcher.match(text, notes);
  const sharingCount = candidates.length;
  const total = notes.length;
  const released = sharingCount >= k && sharingCount > 0;
  const outwardBytes = released
    ? `${sharingCount} of ${total} notes in this vault match what you asked about.`
    : VAULT_NOTHING_SHAREABLE_TEXT;
  return {
    query: { text, requester, gate_states: gateStates },
    scanned,
    candidates,
    k_decision: { sharing_count: sharingCount, total, k, released, line: kDecisionLine(sharingCount, total, k, released) },
    outward: { bytes: outwardBytes },
  };
}
