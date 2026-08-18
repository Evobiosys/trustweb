// Record schema per spec §2. JSONL, one record per line, append-only.
// Updates are supersessions (Graffiti-style latest-wins), never in-place edits.

export type RecordSource = "manual" | "transcript-extraction" | "conversation-update";

export type Category =
  | "housing"
  | "lendable-want-back"
  | "give-without-worry"
  | "network-introduction" // stub: real data lives in the separate network-access module
  | "community-hostable";

export type CareIfLost = "high" | "medium" | "none";

// Max closeness degree this resource may be shared to. NEVER exported outward
// (query.ts's outward trace section must never surface this field).
export type Circle = "self" | "inner" | "solidarity" | "extended";

export type Status = "available" | "lent-out" | "reserved" | "gone" | "retired";

export interface InventoryRecord {
  id: string;
  supersedes: string | null;
  recorded_at: string; // ISO 8601 — when this record was written
  claimed_at: string; // ISO 8601 — when the resource state was stated/observed
  source: RecordSource;
  heard_from: string | null; // reserved: hearsay origin
  verified: boolean | null; // reserved: hearsay verification
  category: Category;
  name: string;
  description: string;
  care_if_lost: CareIfLost;
  circle: Circle;
  status: Status;
  location: string | null;
  availability_note: string | null; // manual dates for housing, no calendar integration
  community_pool: string | null;
  tags: string[];
  note: string | null;
}

// Input for appendRecord: id / recorded_at / supersedes are assigned by the
// store when absent.
export type NewInventoryRecordInput = Omit<InventoryRecord, "id" | "recorded_at" | "supersedes"> & {
  id?: string;
  recorded_at?: string;
  supersedes?: string | null;
};

export const CATEGORIES: Category[] = [
  "housing",
  "lendable-want-back",
  "give-without-worry",
  "network-introduction",
  "community-hostable",
];

export const CARE_IF_LOST: CareIfLost[] = ["high", "medium", "none"];
export const CIRCLES: Circle[] = ["self", "inner", "solidarity", "extended"];
export const STATUSES: Status[] = ["available", "lent-out", "reserved", "gone", "retired"];
export const SOURCES: RecordSource[] = ["manual", "transcript-extraction", "conversation-update"];

export const INACTIVE_STATUSES: Status[] = ["gone", "retired"];
