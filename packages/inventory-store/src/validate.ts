// Hand-rolled validation (spec §0.4: zod optional, prefer zero runtime deps).
import { CARE_IF_LOST, CATEGORIES, CIRCLES, SOURCES, STATUSES } from "./types.js";
import type { InventoryRecord } from "./types.js";

export class InvalidRecordError extends Error {
  constructor(reason: string) {
    super(`invalid inventory record: ${reason}`);
    this.name = "InvalidRecordError";
  }
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isBooleanOrNull(v: unknown): v is boolean | null {
  return v === null || typeof v === "boolean";
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// Throws InvalidRecordError on the first violation found. Returns void (use
// as a type guard via `assertValidRecord(x); // x: InventoryRecord`).
export function assertValidRecord(rec: unknown): asserts rec is InventoryRecord {
  if (typeof rec !== "object" || rec === null) throw new InvalidRecordError("not an object");
  const r = rec as Record<string, unknown>;

  if (!isString(r.id) || r.id.length === 0) throw new InvalidRecordError("id must be a non-empty string");
  if (!isStringOrNull(r.supersedes)) throw new InvalidRecordError("supersedes must be string or null");
  if (!isString(r.recorded_at) || Number.isNaN(Date.parse(r.recorded_at))) {
    throw new InvalidRecordError("recorded_at must be a valid ISO 8601 string");
  }
  if (!isString(r.claimed_at) || Number.isNaN(Date.parse(r.claimed_at))) {
    throw new InvalidRecordError("claimed_at must be a valid ISO 8601 string");
  }
  if (!isString(r.source) || !(SOURCES as string[]).includes(r.source)) {
    throw new InvalidRecordError(`source must be one of ${SOURCES.join(", ")}`);
  }
  if (!isStringOrNull(r.heard_from)) throw new InvalidRecordError("heard_from must be string or null");
  if (!isBooleanOrNull(r.verified)) throw new InvalidRecordError("verified must be boolean or null");
  if (!isString(r.category) || !(CATEGORIES as string[]).includes(r.category)) {
    throw new InvalidRecordError(`category must be one of ${CATEGORIES.join(", ")}`);
  }
  if (!isString(r.name) || r.name.length === 0) throw new InvalidRecordError("name must be a non-empty string");
  if (!isString(r.description)) throw new InvalidRecordError("description must be a string");
  if (!isString(r.care_if_lost) || !(CARE_IF_LOST as string[]).includes(r.care_if_lost)) {
    throw new InvalidRecordError(`care_if_lost must be one of ${CARE_IF_LOST.join(", ")}`);
  }
  if (!isString(r.circle) || !(CIRCLES as string[]).includes(r.circle)) {
    throw new InvalidRecordError(`circle must be one of ${CIRCLES.join(", ")}`);
  }
  if (!isString(r.status) || !(STATUSES as string[]).includes(r.status)) {
    throw new InvalidRecordError(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (!isStringOrNull(r.location)) throw new InvalidRecordError("location must be string or null");
  if (!isStringOrNull(r.availability_note)) throw new InvalidRecordError("availability_note must be string or null");
  if (!isStringOrNull(r.community_pool)) throw new InvalidRecordError("community_pool must be string or null");
  if (!isStringArray(r.tags)) throw new InvalidRecordError("tags must be a string array");
  if (!isStringOrNull(r.note)) throw new InvalidRecordError("note must be string or null");
}
