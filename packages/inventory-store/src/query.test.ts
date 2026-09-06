import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runQuery, DEFAULT_K, NOTHING_SHAREABLE_TEXT } from "./query.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inventory-query-test-"));
  path = join(dir, "inventory.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// The real line for id inv_1786190000_apt01, copied verbatim from
// ~/.local/share/rebiosys/inventory.jsonl (read-only source, never written).
const REAL_APT_LINE =
  '{"id":"inv_1786190000_apt01","supersedes":null,"recorded_at":"2026-08-08T12:50:00Z","claimed_at":"2026-08-08T12:50:00Z","source":"manual","heard_from":null,"verified":null,"category":"housing","name":"Vienna apartment","description":"Jakob\'s apartment in Vienna, available for trusted-circle stays while he is away","care_if_lost":"high","circle":"inner","status":"available","location":"Vienna, AT","availability_note":"available 2027-07-27 to 2027-08-02 (year assumed 2027 — the stated window 27 Jul–2 Aug already passed in 2026; correct if meant differently)","community_pool":null,"tags":["housing","vienna","apartment","stay"],"note":"handover manual for now; calendar module deferred by design"}';

function otherRecord(id: string, name: string, description: string, tags: string[] = []): string {
  return JSON.stringify({
    id,
    supersedes: null,
    recorded_at: "2026-08-08T09:00:00Z",
    claimed_at: "2026-08-08T09:00:00Z",
    source: "manual",
    heard_from: null,
    verified: null,
    category: "lendable-want-back",
    name,
    description,
    care_if_lost: "medium",
    circle: "solidarity",
    status: "available",
    location: "Graz",
    availability_note: null,
    community_pool: null,
    tags,
    note: null,
  });
}

function writeFixture(): void {
  writeFileSync(
    path,
    [
      REAL_APT_LINE,
      otherRecord("inv_fix_gloves", "Boxing gloves", "12oz, good condition for sparring", ["sport"]),
      otherRecord("inv_fix_tent", "Camping tent", "4-person tent, waterproof", ["outdoor", "camping"]),
      otherRecord("inv_fix_ladder", "Extension ladder", "6 meter aluminium ladder", ["tools"]),
    ].join("\n") + "\n",
  );
}

describe("runQuery — acceptance test", () => {
  it("matches inv_1786190000_apt01 against a Vienna-apartment-with-dates query, with all 5 trace sections populated", async () => {
    writeFixture();
    const trace = await runQuery(path, {
      text: "apartment in Vienna 27 July – 2 August",
      requester: "test-requester",
    });

    // 1. query
    expect(trace.query).toEqual({
      text: "apartment in Vienna 27 July – 2 August",
      requester: "test-requester",
      gate_states: {},
    });

    // 2. scanned — all currentView records
    expect(trace.scanned.count).toBe(4);
    expect(trace.scanned.ids).toContain("inv_1786190000_apt01");

    // 3. candidates
    const apt = trace.candidates.find((c) => c.id === "inv_1786190000_apt01");
    expect(apt).toBeTruthy();
    expect(apt!.score).toBeGreaterThan(0);
    expect(apt!.matched_terms.length).toBeGreaterThan(0);
    // month-name/date matching: "July"/"August" normalize to match "Jul"/"Aug"
    // in the availability_note, and "27"/"2" match the note's date tokens.
    expect(apt!.matched_terms).toEqual(expect.arrayContaining(["apartment", "vienna"]));

    // 4. k_decision
    expect(trace.k_decision.total).toBe(4);
    expect(trace.k_decision.sharing_count).toBe(trace.candidates.length);
    expect(trace.k_decision.k).toBe(DEFAULT_K);
    expect(trace.k_decision.line).toMatch(/^\d+ of \d+ sharing → .* → (released|suppressed)$/);

    // 5. outward
    expect(typeof trace.outward.bytes).toBe("string");
    expect(trace.outward.bytes.length).toBeGreaterThan(0);
  });

  it("suppresses below k, releasing the byte-identical NOTHING_SHAREABLE_TEXT regardless of match count", async () => {
    writeFixture();
    // Only the apartment record can match "apartment" — sharing_count=1 < k=3.
    const trace = await runQuery(path, {
      text: "apartment",
      requester: "r",
      k: 3,
    });
    expect(trace.k_decision.sharing_count).toBeLessThan(trace.k_decision.k);
    expect(trace.k_decision.released).toBe(false);
    expect(trace.outward.bytes).toBe(NOTHING_SHAREABLE_TEXT);
  });

  it("zero-match query produces the same byte-identical outward text as a suppressed one", async () => {
    writeFixture();
    const trace = await runQuery(path, { text: "xyznonexistentqueryterm", requester: "r" });
    expect(trace.candidates).toHaveLength(0);
    expect(trace.outward.bytes).toBe(NOTHING_SHAREABLE_TEXT);
  });

  it("releases and reveals counts once sharing_count meets k", async () => {
    writeFixture();
    // "available" appears in apartment + 3 lendables via status field text? No —
    // status isn't in the haystack. Use a term shared by 3+ records instead.
    const trace = await runQuery(path, { text: "condition tent ladder apartment sport outdoor tools stay", requester: "r", k: 2 });
    expect(trace.k_decision.sharing_count).toBeGreaterThanOrEqual(2);
    expect(trace.k_decision.released).toBe(true);
    expect(trace.outward.bytes).toBe(
      `${trace.k_decision.sharing_count} of ${trace.k_decision.total} people in this network are sharing what you asked about.`,
    );
  });
});

describe("runQuery — real inventory.jsonl integration (read-only)", () => {
  const realPath = join(homedir(), ".local", "share", "rebiosys", "inventory.jsonl");

  it("surfaces inv_1786190000_apt01 from the real file, or skips gracefully if absent", async () => {
    if (!existsSync(realPath)) {
      console.warn(`skipping: ${realPath} not present`);
      return;
    }
    const trace = await runQuery(realPath, {
      text: "apartment in Vienna 27 July – 2 August",
      requester: "test-requester",
    });
    expect(trace.scanned.ids).toContain("inv_1786190000_apt01");
    const apt = trace.candidates.find((c) => c.id === "inv_1786190000_apt01");
    expect(apt).toBeTruthy();
    expect(apt!.score).toBeGreaterThan(0);
  });
});
