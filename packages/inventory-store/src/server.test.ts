import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInventoryServer } from "./server.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "inventory-server-test-"));
  path = join(dir, "inventory.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const s = createInventoryServer({ inventoryPath: path, mdOutPath: join(dir, "inventory.md") });
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const addr = s.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;
  try {
    return await fn(url);
  } finally {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
}

describe("server endpoint smoke", () => {
  it("appends a record via POST /api/records, lists it via GET /api/current, and serves the dashboard shell", async () => {
    await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claimed_at: new Date().toISOString(),
          source: "manual",
          heard_from: null,
          verified: null,
          category: "housing",
          name: "Test flat",
          description: "smoke test resource",
          care_if_lost: "high",
          circle: "inner",
          status: "available",
          location: null,
          availability_note: null,
          community_pool: null,
          tags: [],
          note: null,
        }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.record.id).toBeTruthy();

      const currentRes = await fetch(`${base}/api/current`);
      const current = await currentRes.json();
      expect(current).toHaveLength(1);
      expect(current[0].name).toBe("Test flat");

      const historyRes = await fetch(`${base}/api/history/${created.record.id}`);
      const historyBody = await historyRes.json();
      expect(historyBody).toHaveLength(1);

      const mdRes = await fetch(`${base}/api/md`);
      expect(mdRes.status).toBe(200);
      const md = await mdRes.text();
      expect(md).toContain("Test flat");

      const indexRes = await fetch(`${base}/`);
      expect(indexRes.status).toBe(200);
      expect(await indexRes.text()).toContain("<title>inventory-store</title>");

      const queryRes = await fetch(`${base}/api/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requester: "r", text: "flat" }),
      });
      const trace = await queryRes.json();
      expect(trace.scanned.count).toBe(1);
    });
  });

  it("surfaces the pool-coverage warning as {warning} without writing, and proceeds only when confirmed", async () => {
    await withServer(async (base) => {
      const record = {
        claimed_at: new Date().toISOString(),
        source: "manual",
        heard_from: null,
        verified: null,
        category: "give-without-worry",
        name: "Only pooled item",
        description: "the sole non-retired resource",
        care_if_lost: "none",
        circle: "extended",
        status: "available",
        location: null,
        availability_note: null,
        community_pool: "pool-only",
        tags: [],
        note: null,
      };
      // A lone first item trivially satisfies "ALL non-retired resources are
      // in this one pool" per spec's literal wording, so this warns.
      const res = await fetch(`${base}/api/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
      const body = await res.json();
      expect(body.warning).toBe("all-resources-one-pool");

      const confirmRes = await fetch(`${base}/api/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...record, confirmed: true }),
      });
      const confirmed = await confirmRes.json();
      expect(confirmed.record.community_pool).toBe("pool-only");
    });
  });

  it("returns 404 for an unknown supersede target", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/records/does-not-exist/supersede`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "gone" }),
      });
      expect(res.status).toBe(404);
    });
  });
});
