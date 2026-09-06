import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVault } from "./vault.js";
import {
  KeywordVaultMatcher,
  LlmVaultMatcher,
  VAULT_NOTHING_SHAREABLE_TEXT,
  runVaultQuery,
} from "./vault_query.js";
import { DEFAULT_K, NOTHING_SHAREABLE_TEXT } from "@resource-web/network-access";
import { REJECTED_OUTWARD_TEXT } from "./red_flags.js";
import type { ChatClient } from "@resource-web/network-access";

describe("VAULT_NOTHING_SHAREABLE_TEXT", () => {
  it("is byte-identical to the network-access suppression text and the red-flag rejection text", () => {
    // Three independent constants (anonymity.ts, red_flags.ts, vault_query.ts)
    // MUST stay byte-identical, or a vault suppression, a network
    // suppression, and a red-flagged rejection would become distinguishable
    // from each other — exactly the cross-surface leak I3-style
    // indistinguishability exists to prevent.
    expect(VAULT_NOTHING_SHAREABLE_TEXT).toBe(NOTHING_SHAREABLE_TEXT);
    expect(VAULT_NOTHING_SHAREABLE_TEXT).toBe(REJECTED_OUTWARD_TEXT);
  });
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "na-vault-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeNote(relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("loadVault", () => {
  it("reads only .md files, recursively, using the first H1 as title", () => {
    writeNote("camping-gear.md", "# Camping gear\nTent and sleeping bags to lend.");
    writeNote("sub/notes.md", "no heading here, just body text");
    writeNote("ignore.txt", "not markdown, must not appear");
    const notes = loadVault(dir);
    expect(notes).toHaveLength(2);
    const camping = notes.find((n) => n.id === "camping-gear")!;
    expect(camping.title).toBe("Camping gear");
    const sub = notes.find((n) => n.id === join("sub", "notes"))!;
    expect(sub.title).toBe("notes"); // falls back to filename, no H1 present
  });

  it("returns [] for a folder that doesn't exist yet, rather than throwing", () => {
    expect(loadVault(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("KeywordVaultMatcher + runVaultQuery", () => {
  function seedCampingVault(): void {
    writeNote("camping-gear-inventory.md", "# Camping gear inventory\nTent, sleeping bags, camping stove available.");
    writeNote("weekend-trip-planning.md", "# Weekend trip planning\nCamping trip checklist: gear, food, route.");
    writeNote("borrowed-tent-notes.md", "# Borrowed tent notes\nA 4-person tent available for camping weekends.");
    writeNote("hiking-boots-tracker.md", "# Hiking boots tracker\nHiking boots and camping backpack condition log.");
    writeNote("sourdough-starter-log.md", "# Sourdough starter log\nFeeding schedule and hydration notes.");
    writeNote("community-garden-plan.md", "# Community garden plan\nBed rotation and compost schedule.");
    writeNote("book-recommendations.md", "# Book recommendations\nNovels and essays worth a read.");
    writeNote("bike-repair-log.md", "# Bike repair log\nBrake pads and chain lube history.");
    // Three more camping-vocabulary notes so a floor as high as 7 is still
    // clearable by this fixture's default-k test below. The trunk default is
    // DEFAULT_K (3); the fixture is deliberately sized for a floor of 7 too,
    // so the C-08 prevalence run can retune the floor upward without
    // rewriting this corpus.
    writeNote("camp-stove-loan.md", "# Camp stove loan\nCamping stove and cooler free to borrow for a weekend trip.");
    writeNote("spare-sleeping-bags.md", "# Spare sleeping bags\nTwo sleeping bags to borrow for a camping weekend trip.");
    writeNote("rooftop-tent.md", "# Rooftop tent\nRooftop tent to lend for a camping weekend, fits most roof racks.");
  }

  it("releases the aggregate at the default k when enough notes share the topic", async () => {
    seedCampingVault();
    const notes = loadVault(dir);
    const matcher = new KeywordVaultMatcher();
    const trace = await runVaultQuery(notes, matcher, {
      text: "Does anyone have camping gear I could borrow for a weekend trip?",
      requester: "anna@example.org",
      gateStates: { gate0: "standing_allow", gate1: "manual", gate2: "manual" },
    });
    expect(trace.query.gate_states).toEqual({ gate0: "standing_allow", gate1: "manual", gate2: "manual" });
    expect(trace.scanned.count).toBe(11);
    expect(trace.k_decision.k).toBe(DEFAULT_K);
    expect(DEFAULT_K).toBe(3);
    expect(trace.k_decision.sharing_count).toBeGreaterThanOrEqual(7);
    expect(trace.k_decision.released).toBe(true);
    expect(trace.outward.bytes).toBe(
      `${trace.k_decision.sharing_count} of 11 notes in this vault match what you asked about.`,
    );
    expect(trace.candidates.every((c) => c.matched_terms.length > 0)).toBe(true);
  });

  it("releases at a custom, lower k when explicitly passed (contract-style override)", async () => {
    seedCampingVault();
    const notes = loadVault(dir);
    const matcher = new KeywordVaultMatcher();
    const trace = await runVaultQuery(notes, matcher, {
      text: "Does anyone have camping gear I could borrow for a weekend trip?",
      requester: "anna@example.org",
      k: 2,
    });
    expect(trace.k_decision.k).toBe(2);
    expect(trace.k_decision.released).toBe(true);
  });

  it("suppresses below k with the byte-identical nothing-shareable text", async () => {
    seedCampingVault();
    const notes = loadVault(dir);
    const matcher = new KeywordVaultMatcher();
    const trace = await runVaultQuery(notes, matcher, {
      text: "does anyone want to trade rare stamps",
      requester: "anna@example.org",
    });
    expect(trace.k_decision.released).toBe(false);
    expect(trace.outward.bytes).toBe(VAULT_NOTHING_SHAREABLE_TEXT);
  });

  it("zero matches and below-k matches are byte-identical outward (no count leak)", async () => {
    seedCampingVault();
    const notes = loadVault(dir);
    const matcher = new KeywordVaultMatcher();
    const zero = await runVaultQuery(notes, matcher, { text: "zzz nonword qqq", requester: "a" });
    // Force exactly one match by querying a term that appears in only one note.
    const one = await runVaultQuery(notes, matcher, { text: "sourdough hydration", requester: "a" });
    expect(zero.k_decision.sharing_count).toBe(0);
    expect(one.k_decision.sharing_count).toBeGreaterThan(0);
    expect(one.k_decision.sharing_count).toBeLessThan(DEFAULT_K);
    expect(zero.outward.bytes).toBe(one.outward.bytes);
  });
});

describe("LlmVaultMatcher", () => {
  it("uses the chat client's matches when it returns well-formed JSON", async () => {
    writeNote("a.md", "# A\nsome text");
    writeNote("b.md", "# B\nother text");
    const notes = loadVault(dir);
    const fakeClient: ChatClient = {
      async chat() {
        return JSON.stringify({ matches: [{ id: "a", reason: "fits" }] });
      },
    };
    const matcher = new LlmVaultMatcher(fakeClient, "fake-model", new KeywordVaultMatcher());
    const candidates = await matcher.match("anything", notes);
    expect(candidates).toEqual([{ id: "a", title: "A", matched_terms: ["fits"], score: 1 }]);
  });

  it("falls back to the keyword matcher on malformed JSON — never throws, never touches a real model", async () => {
    writeNote("camping-gear.md", "# Camping gear\ntent and sleeping bag");
    const notes = loadVault(dir);
    const brokenClient: ChatClient = {
      async chat() {
        return "not json at all, sorry";
      },
    };
    const matcher = new LlmVaultMatcher(brokenClient, "fake-model", new KeywordVaultMatcher());
    const candidates = await matcher.match("camping gear", notes);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe("camping-gear");
  });

  it("falls back when the client throws (e.g. ollama unreachable) — same guarantee, no network in tests", async () => {
    writeNote("camping-gear.md", "# Camping gear\ntent and sleeping bag");
    const notes = loadVault(dir);
    const throwingClient: ChatClient = {
      async chat() {
        throw new Error("fetch failed: connection refused");
      },
    };
    const matcher = new LlmVaultMatcher(throwingClient, "fake-model", new KeywordVaultMatcher());
    const candidates = await matcher.match("camping gear", notes);
    expect(candidates).toHaveLength(1);
  });

  it("ignores an id the LLM invented that isn't in the corpus", async () => {
    writeNote("a.md", "# A\nreal note");
    const notes = loadVault(dir);
    const fakeClient: ChatClient = {
      async chat() {
        return JSON.stringify({ matches: [{ id: "made-up-id", reason: "??" }] });
      },
    };
    const matcher = new LlmVaultMatcher(fakeClient, "fake-model", new KeywordVaultMatcher());
    const candidates = await matcher.match("anything", notes);
    expect(candidates).toEqual([]);
  });
});
