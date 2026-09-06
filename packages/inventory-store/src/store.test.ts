import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRecord,
  supersede,
  listAll,
  currentView,
  history,
  renderMd,
  PoolCoverageWarning,
  UnknownRecordError,
  AlreadySupersededError,
} from "./store.js";
import { InvalidRecordError } from "./validate.js";
import type { NewInventoryRecordInput } from "./types.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inventory-store-test-"));
  path = join(dir, "inventory.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseInput(overrides: Partial<NewInventoryRecordInput> = {}): NewInventoryRecordInput {
  return {
    claimed_at: "2026-08-08T10:00:00+02:00",
    source: "manual",
    heard_from: null,
    verified: null,
    category: "housing",
    name: "Vienna apartment",
    description: "Whole flat while away",
    care_if_lost: "high",
    circle: "inner",
    status: "available",
    location: "Wien",
    availability_note: "free 2026-09-01..09-14",
    community_pool: null,
    tags: ["housing", "vienna"],
    note: null,
    ...overrides,
  };
}

describe("appendRecord / round-trip", () => {
  it("assigns id and recorded_at, appends a line, and round-trips via listAll", async () => {
    const rec = await appendRecord(path, baseInput());
    expect(rec.id).toMatch(/^inv_\d+_[0-9a-f]+$/);
    expect(rec.recorded_at).toBeTruthy();
    expect(rec.supersedes).toBeNull();

    const all = await listAll(path);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(rec);

    const raw = readFileSync(path, "utf8").trim();
    expect(raw.split("\n")).toHaveLength(1);
    expect(JSON.parse(raw)).toEqual(rec);
  });

  it("never rewrites the file — a second append just adds a line", async () => {
    await appendRecord(path, baseInput({ name: "A" }));
    await appendRecord(path, baseInput({ name: "B" }));
    const raw = readFileSync(path, "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
  });

  it("rejects an invalid record", async () => {
    await expect(
      appendRecord(path, baseInput({ category: "not-a-category" as any })),
    ).rejects.toBeInstanceOf(InvalidRecordError);
    expect(existsSync(path)).toBe(false);
  });
});

describe("supersede / chain resolution", () => {
  it("resolves a 3-deep supersession chain and currentView returns only the head", async () => {
    const v1 = await appendRecord(path, baseInput({ name: "Boxing gloves", status: "available" }));
    const v2 = await supersede(path, v1.id, { status: "lent-out", note: "lent to M." });
    const v3 = await supersede(path, v2.id, { status: "available", note: null });

    expect(v2.supersedes).toBe(v1.id);
    expect(v3.supersedes).toBe(v2.id);

    const view = await currentView(path);
    expect(view).toHaveLength(1);
    expect(view[0]!.id).toBe(v3.id);
    expect(view[0]!.status).toBe("available");

    const chain = await history(path, v1.id);
    expect(chain.map((r) => r.id)).toEqual([v1.id, v2.id, v3.id]);
    // history() also resolves from a mid-chain or head id
    expect((await history(path, v2.id)).map((r) => r.id)).toEqual([v1.id, v2.id, v3.id]);
  });

  it("errors on unknown id", async () => {
    await expect(supersede(path, "nope", { status: "gone" })).rejects.toBeInstanceOf(UnknownRecordError);
  });

  it("errors on an already-superseded id, pointing at the chain head", async () => {
    const v1 = await appendRecord(path, baseInput());
    const v2 = await supersede(path, v1.id, { status: "gone" });
    let caught: unknown;
    try {
      await supersede(path, v1.id, { status: "available" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AlreadySupersededError);
    expect((caught as AlreadySupersededError).headId).toBe(v2.id);
  });
});

describe("currentView", () => {
  it("excludes superseded and gone/retired records by default", async () => {
    const a = await appendRecord(path, baseInput({ name: "Active" }));
    const b = await appendRecord(path, baseInput({ name: "Gone", status: "gone" }));
    const c = await appendRecord(path, baseInput({ name: "ToSupersede" }));
    await supersede(path, c.id, { status: "retired" });

    const view = await currentView(path);
    const ids = view.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids).not.toContain(c.id);

    const withInactive = await currentView(path, { includeInactive: true });
    expect(withInactive.map((r) => r.id)).toContain(b.id);
  });
});

describe("community_pool coverage warning", () => {
  it("fires when a write would place ALL non-retired resources into one pool, and never silently proceeds", async () => {
    // A is the first record ever, so a lone pooled item trivially warns too —
    // confirm it through (covered by its own dedicated test above/below).
    await appendRecord(path, baseInput({ name: "A", community_pool: "pool-x" }), { confirmed: true });
    await appendRecord(path, baseInput({ name: "B", community_pool: "pool-y" }));

    // B is still in a different pool, so this should NOT warn yet.
    await expect(
      appendRecord(path, baseInput({ name: "C", community_pool: "pool-x" })),
    ).resolves.toBeTruthy();

    // Now move B into pool-x too — this makes everything pool-x.
    const bView = (await currentView(path)).find((r) => r.name === "B")!;
    await expect(supersede(path, bView.id, { community_pool: "pool-x" })).rejects.toBeInstanceOf(
      PoolCoverageWarning,
    );

    // Confirmed retry proceeds.
    const result = await supersede(path, bView.id, { community_pool: "pool-x" }, { confirmed: true });
    expect(result.community_pool).toBe("pool-x");
    const view = await currentView(path);
    expect(view.every((r) => r.community_pool === "pool-x")).toBe(true);
  });

  it("fires even for a lone resource — a single pooled item trivially puts ALL non-retired resources in one pool", async () => {
    await expect(
      appendRecord(path, baseInput({ name: "Solo", community_pool: "pool-only" })),
    ).rejects.toBeInstanceOf(PoolCoverageWarning);
    // Confirmed retry proceeds.
    await expect(
      appendRecord(path, baseInput({ name: "Solo", community_pool: "pool-only" }), { confirmed: true }),
    ).resolves.toBeTruthy();
  });

  it("does not fire when community_pool is left unset", async () => {
    await expect(appendRecord(path, baseInput({ name: "Unpooled", community_pool: null }))).resolves.toBeTruthy();
  });
});

describe("renderMd", () => {
  it("generates a grouped, read-only markdown snapshot", async () => {
    await appendRecord(path, baseInput({ name: "Vienna apartment", category: "housing" }));
    await appendRecord(
      path,
      baseInput({ name: "Boxing gloves", category: "lendable-want-back", care_if_lost: "medium", circle: "solidarity" }),
    );
    const outPath = join(dir, "inventory.md");
    await renderMd(path, outPath);
    const md = readFileSync(outPath, "utf8");
    expect(md).toContain("do not edit — regenerate via renderMd");
    expect(md).toContain("## Housing");
    expect(md).toContain("Vienna apartment");
    expect(md).toContain("## Lendable (want back)");
    expect(md).toContain("Boxing gloves");
    expect(md).toMatchSnapshot();
  });
});
