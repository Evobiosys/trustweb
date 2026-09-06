// Restore-trust prompt (owner review UI, follow-on to D22's red-flag
// handling): "either you've been hacked, or you're a malicious actor" —
// the owner's response is to ask the requester to re-verify. This module
// only RECORDS that the owner asked for that nudge to go out; it does not
// send anything. Actual delivery (over the web of trust / matrix / signal —
// whichever channel resolve_contact_options.ts finds for that requester) is
// TODO, tracked in DECISIONS.md, not implemented here.
//
// Storage mirrors red_flags.ts's idiom exactly: append-only JSONL,
// best-effort parse (a bad line is skipped, never thrown on).
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface RestorePromptEvent {
  id: string;
  ts: string;
  redFlagId: string;
  requester: string;
  /** Always "recorded" today — no transport wired yet (TODO: deliver over
   * WoT/Matrix/Signal per the requester's resolved reach-out channel). */
  status: "recorded";
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export interface RecordRestorePromptInput {
  redFlagId: string;
  requester: string;
  now?: number;
}

/** Appends one restore-prompt event. Returns it so the caller (the owner
 * review UI's action handler) can show it immediately without a re-fetch. */
export function recordRestorePrompt(path: string, input: RecordRestorePromptInput): RestorePromptEvent {
  const event: RestorePromptEvent = {
    id: randomUUID(),
    ts: new Date(input.now ?? Date.now()).toISOString(),
    redFlagId: input.redFlagId,
    requester: input.requester,
    status: "recorded",
  };
  ensureFile(path);
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return event;
}

/** Full local log, chronological (write order). */
export function listRestorePrompts(path: string): RestorePromptEvent[] {
  if (!existsSync(path)) return [];
  const out: RestorePromptEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RestorePromptEvent);
    } catch {
      // skip malformed line — audit-trail read stays best-effort
    }
  }
  return out;
}

/** Most recent restore-prompt event for one red-flag id, or undefined if
 * never sent — lets the owner UI show "already asked at <time>" and avoid
 * firing the same nudge twice in a row. */
export function latestRestorePromptFor(events: RestorePromptEvent[], redFlagId: string): RestorePromptEvent | undefined {
  return events
    .filter((e) => e.redFlagId === redFlagId)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0];
}
