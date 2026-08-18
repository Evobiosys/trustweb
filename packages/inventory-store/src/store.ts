// Store API over a JSONL file path (spec §3). Append-only: supersession
// (Graffiti-style latest-wins) replaces edit-in-place. Every function is a
// pure function of (path, ...args) — no module-level state.
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { INACTIVE_STATUSES } from "./types.js";
import type { InventoryRecord, NewInventoryRecordInput } from "./types.js";
import { assertValidRecord } from "./validate.js";

export class UnknownRecordError extends Error {
  constructor(id: string) {
    super(`unknown inventory record id: ${id}`);
    this.name = "UnknownRecordError";
  }
}

export class AlreadySupersededError extends Error {
  constructor(
    public readonly requestedId: string,
    public readonly headId: string,
  ) {
    super(`record ${requestedId} is already superseded — chain head is ${headId}`);
    this.name = "AlreadySupersededError";
  }
}

// Thrown by appendRecord/supersede when the write would place ALL non-retired
// resources into a single community_pool, and the caller has not confirmed.
// "Never silently proceed" (spec §3): the caller (CLI/dashboard) must surface
// this and retry with confirmed:true.
export class PoolCoverageWarning extends Error {
  readonly warning = "all-resources-one-pool" as const;
  constructor(public readonly poolId: string) {
    super(`all resources would fall into a single community_pool (${poolId})`);
    this.name = "PoolCoverageWarning";
  }
}

export interface WriteOptions {
  confirmed?: boolean;
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "");
}

function newId(): string {
  return `inv_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function parseLines(raw: string): InventoryRecord[] {
  const records: InventoryRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as InventoryRecord;
    records.push(parsed);
  }
  return records;
}

// Raw lines in file (write/chronological) order — audit/debug view.
export async function listAll(path: string): Promise<InventoryRecord[]> {
  if (!existsSync(path)) return [];
  return parseLines(readFileSync(path, "utf8"));
}

export interface CurrentViewOptions {
  includeInactive?: boolean;
}

// Latest-wins resolution: follow supersession chains, return only heads.
// Excludes gone/retired unless includeInactive.
export async function currentView(
  path: string,
  opts: CurrentViewOptions = {},
): Promise<InventoryRecord[]> {
  const all = await listAll(path);
  const byId = new Map<string, InventoryRecord>();
  const superseded = new Set<string>();
  for (const rec of all) {
    byId.set(rec.id, rec); // last occurrence of an id wins (should be unique anyway)
    if (rec.supersedes) superseded.add(rec.supersedes);
  }
  const heads = [...byId.values()].filter((r) => !superseded.has(r.id));
  if (opts.includeInactive) return heads;
  return heads.filter((r) => !INACTIVE_STATUSES.includes(r.status));
}

// Full supersession chain for a resource, oldest first, given any id in the chain.
export async function history(path: string, id: string): Promise<InventoryRecord[]> {
  const all = await listAll(path);
  const byId = new Map(all.map((r) => [r.id, r]));
  const bySupersedes = new Map<string, InventoryRecord>();
  for (const r of all) if (r.supersedes) bySupersedes.set(r.supersedes, r);

  let head = byId.get(id);
  if (!head) throw new UnknownRecordError(id);
  // Walk forward to the chain head (in case `id` is mid-chain).
  while (bySupersedes.has(head.id)) head = bySupersedes.get(head.id)!;

  const chain: InventoryRecord[] = [head];
  let cursor = head;
  while (cursor.supersedes) {
    const prev = byId.get(cursor.supersedes);
    if (!prev) break;
    chain.unshift(prev);
    cursor = prev;
  }
  return chain;
}

// Would writing `incoming` (replacing `replacing`, if any) push every
// non-retired/gone resource into a single community_pool?
async function checkPoolCoverage(
  path: string,
  incoming: InventoryRecord,
  replacingId: string | null,
): Promise<void> {
  if (!incoming.community_pool) return;
  if (INACTIVE_STATUSES.includes(incoming.status)) return;
  const view = await currentView(path);
  const projected = view.filter((r) => r.id !== replacingId);
  projected.push(incoming);
  if (projected.length === 0) return;
  const allSamePool = projected.every((r) => r.community_pool === incoming.community_pool);
  if (allSamePool) throw new PoolCoverageWarning(incoming.community_pool);
}

// Validates, assigns id/recorded_at if absent, appends one line. Never
// rewrites the file.
export async function appendRecord(
  path: string,
  input: NewInventoryRecordInput,
  opts: WriteOptions = {},
): Promise<InventoryRecord> {
  const record: InventoryRecord = {
    ...input,
    id: input.id ?? newId(),
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    supersedes: input.supersedes ?? null,
  };
  assertValidRecord(record);

  if (!opts.confirmed) {
    await checkPoolCoverage(path, record, null);
  }

  ensureFile(path);
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

// Loads current view, clones the latest record of chain `oldId`, applies
// patch, appends with supersedes: oldId. Errors if oldId is unknown or
// already superseded (points at the chain head).
export async function supersede(
  path: string,
  oldId: string,
  patch: Partial<Omit<InventoryRecord, "id" | "supersedes" | "recorded_at">>,
  opts: WriteOptions = {},
): Promise<InventoryRecord> {
  const view = await currentView(path, { includeInactive: true });
  const head = view.find((r) => r.id === oldId);
  if (!head) {
    const all = await listAll(path);
    const known = all.find((r) => r.id === oldId);
    if (!known) throw new UnknownRecordError(oldId);
    const chain = await history(path, oldId);
    const chainHead = chain[chain.length - 1]!;
    throw new AlreadySupersededError(oldId, chainHead.id);
  }

  const next: InventoryRecord = {
    ...head,
    ...patch,
    id: newId(),
    recorded_at: new Date().toISOString(),
    supersedes: oldId,
  };
  assertValidRecord(next);

  if (!opts.confirmed) {
    await checkPoolCoverage(path, next, oldId);
  }

  appendFileSync(path, `${JSON.stringify(next)}\n`);
  return next;
}

const CATEGORY_LABEL: Record<string, string> = {
  housing: "Housing",
  "lendable-want-back": "Lendable (want back)",
  "give-without-worry": "Give without worry",
  "network-introduction": "Network introduction",
  "community-hostable": "Community hostable",
};

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// Generated READ-ONLY .md of currentView, grouped by category.
export async function renderMd(path: string, outPath: string): Promise<void> {
  const view = await currentView(path);
  const byCategory = new Map<string, InventoryRecord[]>();
  for (const r of view) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const lines: string[] = [];
  lines.push("<!-- generated by inventory-store renderMd — do not edit — regenerate via renderMd -->");
  lines.push("# Inventory");
  lines.push("");
  const categories = [...byCategory.keys()].sort();
  for (const category of categories) {
    lines.push(`## ${CATEGORY_LABEL[category] ?? category}`);
    lines.push("");
    lines.push("| name | status | care_if_lost | circle | availability_note | claimed_at |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of byCategory.get(category)!.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `| ${mdEscape(r.name)} | ${r.status} | ${r.care_if_lost} | ${r.circle} | ${mdEscape(
          r.availability_note ?? "",
        )} | ${r.claimed_at} |`,
      );
    }
    lines.push("");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
}
