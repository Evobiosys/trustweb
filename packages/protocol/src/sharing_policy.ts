// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// Sharing policy: "may this asker see this item?" for tags + trust zones + persons + groups.
// Prototype of docs/research/sharing-layer-options.md option B; design in docs/design/sharing-policy.md.
//
// Pure and synchronous: no I/O, no clock (the caller passes `now`), no dependencies (I5: this file is
// the interface and the tiny reference engine; a different engine may implement `checkSharing`).
// It runs on the owner's device only (I1). Only `eligible` may travel toward asker-facing code (I2/I3);
// `audit` and `cost` are for the owner's local log (I6) and for tests.
//
// Semantics, in order:
//   1. any matching BLOCK (person or group; never expires)  -> not eligible, whatever else is granted
//   2. any live GRANT that matches the asker                -> eligible
//        grants = item.viewers + tagGrants whose tag the item carries
//   3. otherwise                                            -> not eligible (default deny, I9)
// Expired grants and expired zone assertions count for nothing; an unparseable expiry counts as expired.
// Whether eligible means "ask first" is consent, owned by the lifecycle state machine, not decided here.
import type { TrustLevel } from "./schemas.js";

/** Group nesting is followed at most this many hops (a person's own groups are hop 0). */
export const MAX_GROUP_DEPTH = 4;

const ZONE_RANK: Record<TrustLevel, number> = { contact: 1, friend: 2, close: 3 };

export type Subject =
  | { kind: "person"; id: string }
  | { kind: "group"; id: string }
  /** Everyone whose live zone is this level or an inner one (close ⊂ friend ⊂ contact). */
  | { kind: "zone"; level: TrustLevel }
  /** Everyone carrying this tag on their person record. */
  | { kind: "person_tag"; tag: string };

export interface Grant {
  subject: Subject;
  /** ISO timestamp. Required: nothing is granted forever (I9). */
  expiresAt: string;
}

/** An owner-level blanket rule: every item tagged `tag` is visible to `grant.subject`. */
export interface TagGrant {
  tag: string;
  grant: Grant;
}

export interface PersonRecord {
  zone?: { level: TrustLevel; expiresAt: string };
  /** Tags on the person (owner-private; never leave the device). */
  tags?: string[];
  /** Groups the person belongs to directly. */
  groups?: string[];
}

export interface GroupRecord {
  /** Groups this group is a member of: members of this group are members of those too. */
  memberOf?: string[];
}

export interface SharingGraph {
  persons: Record<string, PersonRecord>;
  groups: Record<string, GroupRecord>;
}

export interface SharingItem {
  id: string;
  /** Tags on the item (owner-private). */
  tags: string[];
  /** Per-item grants. */
  viewers: Grant[];
  /** Per-item denies. Beat every grant. */
  blocks: Subject[];
}

export interface SharingInput {
  graph: SharingGraph;
  tagGrants: TagGrant[];
  item: SharingItem;
  asker: string;
  now: Date;
}

export interface SharingDecision {
  eligible: boolean;
  /** Human-readable reasons for the owner's local audit log (I6). Never send to the asker. */
  audit: string[];
  /** Rules examined. Independent of who asks and of the outcome (see docs, "what this does not guarantee"). */
  cost: number;
}

/** The swappable seam (I5). */
export interface SharingPolicy {
  check(input: SharingInput): SharingDecision;
}

interface Asker {
  id: string;
  zoneRank: number;
  tags: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

function live(expiresAt: string, now: Date): boolean {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > now.getTime();
}

function resolveGroups(graph: SharingGraph, direct: readonly string[]): Set<string> {
  const seen = new Set<string>();
  let frontier = [...direct];
  for (let depth = 0; depth <= MAX_GROUP_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(...(graph.groups[id]?.memberOf ?? []));
    }
    frontier = next;
  }
  return seen;
}

function describeAsker(graph: SharingGraph, id: string, now: Date): Asker {
  const rec = graph.persons[id];
  const zoneRank = rec?.zone && live(rec.zone.expiresAt, now) ? ZONE_RANK[rec.zone.level] : 0;
  return { id, zoneRank, tags: new Set(rec?.tags ?? []), groups: resolveGroups(graph, rec?.groups ?? []) };
}

function matches(s: Subject, a: Asker): boolean {
  switch (s.kind) {
    case "person": return s.id === a.id;
    case "group": return a.groups.has(s.id);
    case "zone": return a.zoneRank >= ZONE_RANK[s.level];
    case "person_tag": return a.tags.has(s.tag);
  }
}

function label(s: Subject): string {
  switch (s.kind) {
    case "person": return `person ${s.id}`;
    case "group": return `group ${s.id}`;
    case "zone": return `zone ${s.level}`;
    case "person_tag": return `persons tagged ${s.tag}`;
  }
}

/**
 * Decide whether `asker` may see `item`. Every rule is examined (no early exit), so the amount of
 * work is a function of the policy alone.
 */
export function checkSharing(input: SharingInput): SharingDecision {
  const { graph, tagGrants, item, now } = input;
  const asker = describeAsker(graph, input.asker, now);
  const audit: string[] = [];
  let cost = 0;

  let blocked = false;
  for (const b of item.blocks) {
    cost++;
    if (matches(b, asker)) {
      blocked = true;
      audit.push(`blocked: ${asker.id} matches block on ${label(b)} for item ${item.id}`);
    }
  }

  let granted = false;
  for (const v of item.viewers) {
    cost++;
    if (live(v.expiresAt, now) && matches(v.subject, asker)) {
      granted = true;
      audit.push(`grant: ${asker.id} via item grant to ${label(v.subject)}`);
    }
  }
  const itemTags = new Set(item.tags);
  for (const tg of tagGrants) {
    cost++;
    if (itemTags.has(tg.tag) && live(tg.grant.expiresAt, now) && matches(tg.grant.subject, asker)) {
      granted = true;
      audit.push(`grant: ${asker.id} via tag "${tg.tag}" grant to ${label(tg.grant.subject)}`);
    }
  }

  if (blocked) return { eligible: false, audit, cost };
  if (granted) return { eligible: true, audit: audit.map((l) => l.replace(/^grant:/, "allowed:")), cost };
  return { eligible: false, audit: [`denied: no live grant matches ${asker.id} for item ${item.id}`], cost };
}

export const referenceSharingPolicy: SharingPolicy = { check: checkSharing };
