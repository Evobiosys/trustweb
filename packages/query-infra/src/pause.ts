// Pause control (memo item 3): "it slows my phone/laptop" — the owner can
// pause all query processing. Pausing stops new matcher runs and new
// template-gated ingestion from starting; it does NOT hold back outward
// release of work already consented and completed (the owner already said
// yes to that one — see query_gateway.ts's submitQuery, which is the only
// caller of enqueue()). Queued queries persist across process restarts
// (state written atomically to disk, same pattern as network-access's own
// QueryStore) and resume in order when the owner unpauses.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PauseState {
  paused: boolean;
  /** ISO timestamp of the last pause()/resume() transition, or null before either has ever run. */
  since: string | null;
}

const DEFAULT_STATE: PauseState = { paused: false, since: null };

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** Atomic write: tmp file + rename, matching QueryStore.persist()'s pattern
 * so a crash mid-write can never leave a half-written state or queue file. */
function writeAtomic(path: string, contents: string): void {
  ensureDir(path);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

export function readPauseState(path: string): PauseState {
  if (!existsSync(path)) return DEFAULT_STATE;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PauseState;
  } catch {
    return DEFAULT_STATE;
  }
}

export function isPaused(path: string): boolean {
  return readPauseState(path).paused;
}

export function setPaused(path: string, paused: boolean, now: number = Date.now()): PauseState {
  const state: PauseState = { paused, since: new Date(now).toISOString() };
  writeAtomic(path, JSON.stringify(state, null, 2));
  return state;
}

/** One deferred unit of work: whatever the gateway would otherwise have
 * started processing immediately. Opaque payload — pause.ts doesn't know or
 * care what a "network" vs "vault" query looks like, it only persists and
 * replays it. */
export interface QueuedItem<T = unknown> {
  id: string;
  enqueued_at: string;
  payload: T;
}

/** Appends one queued item. Append-only while paused — the queue file is
 * only ever truncated by drain(), never rewritten line-by-line, so a crash
 * between two enqueue() calls loses nothing already written. */
export function enqueue<T>(queuePath: string, item: QueuedItem<T>): void {
  ensureDir(queuePath);
  if (!existsSync(queuePath)) writeFileSync(queuePath, "");
  appendFileSync(queuePath, `${JSON.stringify(item)}\n`);
}

/**
 * Drains the queue: reads every item, then atomically truncates the file
 * (tmp + rename) BEFORE returning — so a caller that crashes partway through
 * processing the returned items doesn't re-drain items it already started
 * (at most, a query goes unresumed until the owner is told to nudge it
 * again, never double-run). Calling drain() twice in a row (double-resume)
 * returns [] the second time: the file is already empty.
 */
export function drain<T>(queuePath: string): QueuedItem<T>[] {
  if (!existsSync(queuePath)) return [];
  const raw = readFileSync(queuePath, "utf8");
  const items: QueuedItem<T>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line) as QueuedItem<T>);
    } catch {
      // skip malformed line
    }
  }
  writeAtomic(queuePath, "");
  return items;
}

/** Peek without draining — used by the owner UI to show "N queued while paused". */
export function peekQueueLength(queuePath: string): number {
  if (!existsSync(queuePath)) return 0;
  return readFileSync(queuePath, "utf8")
    .split("\n")
    .filter((l) => l.trim()).length;
}
