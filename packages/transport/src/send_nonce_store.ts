// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// SendNonceStore — the relay's memory of consumed POST /relay/send nonces
// (relay_send_auth.ts). A (did, nonce) pair is held until its signed
// timestamp can no longer pass the freshness window (`expiresAt`), so a
// captured request cannot be accepted twice by the same relay.
//
// Why a store and not just a Map: with only process memory, restarting the
// relay forgot every consumed nonce and reopened the whole ±window to replay
// (finding F2). SqliteSendNonceStore persists the pairs, normally in the same
// SQLite file as the relay queue, so a replay after a restart is still
// refused. The in-memory store remains for tests and throwaway relays.
//
// The store is dumb on purpose: no clock, no caps. SendAuthVerifier decides
// when to prune (against its monotonic high-water clock) and enforces the
// per-DID / global budgets via countFor()/total(). Only nonces of sends whose
// signature already verified are ever added, so unauthenticated traffic
// cannot grow it.
//
// Mirrors relay_queue_store.ts's node:sqlite access pattern exactly (same
// createRequire indirection, same "no native dependency in this package"
// constraint per DECISIONS.md D6).
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const requireCjs = createRequire(import.meta.url);
const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");

export interface SendNonceStore {
  /** Whether (did, nonce) is currently remembered. */
  has(did: string, nonce: string): boolean;
  /** Remember (did, nonce) until `expiresAt` (ms epoch). Re-adding keeps the later expiry. */
  add(did: string, nonce: string, expiresAt: number): void;
  /** Remembered nonces for `did` — backs the per-DID budget (429). */
  countFor(did: string): number;
  /** Remembered nonces across all DIDs — backs the global budget (503). */
  total(): number;
  /** Forget every pair whose expiresAt is strictly before `now`. */
  prune(now: number): void;
}

/** Process-memory store: lost on restart (the pre-F2 behaviour). Fine for tests and single-run relays. */
export class InMemorySendNonceStore implements SendNonceStore {
  /** `${did}\n${nonce}` -> entry. "\n" cannot occur in a nonce (/^[A-Za-z0-9_-]+$/), so keys are unambiguous. */
  private readonly seen = new Map<string, { did: string; expiresAt: number }>();
  private readonly perDid = new Map<string, number>();

  has(did: string, nonce: string): boolean {
    return this.seen.has(key(did, nonce));
  }

  add(did: string, nonce: string, expiresAt: number): void {
    const k = key(did, nonce);
    const existing = this.seen.get(k);
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      return;
    }
    this.seen.set(k, { did, expiresAt });
    this.perDid.set(did, (this.perDid.get(did) ?? 0) + 1);
  }

  countFor(did: string): number {
    return this.perDid.get(did) ?? 0;
  }

  total(): number {
    return this.seen.size;
  }

  prune(now: number): void {
    for (const [k, entry] of this.seen) {
      if (entry.expiresAt >= now) continue;
      this.seen.delete(k);
      const left = (this.perDid.get(entry.did) ?? 1) - 1;
      if (left <= 0) this.perDid.delete(entry.did);
      else this.perDid.set(entry.did, left);
    }
  }
}

function key(did: string, nonce: string): string {
  return `${did}\n${nonce}`;
}

/**
 * SQLite-backed store: consumed nonces survive a relay restart, so restarting
 * does not reopen the replay window. Safe to point at the relay queue's db
 * file (its own table, created if absent).
 */
export class SqliteSendNonceStore implements SendNonceStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS relay_send_nonces (" +
        "did TEXT NOT NULL, " +
        "nonce TEXT NOT NULL, " +
        "expires_at INTEGER NOT NULL, " +
        "PRIMARY KEY (did, nonce)" +
        ")"
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS relay_send_nonces_expires_at ON relay_send_nonces (expires_at)");
  }

  has(did: string, nonce: string): boolean {
    return this.db.prepare("SELECT 1 AS x FROM relay_send_nonces WHERE did = ? AND nonce = ?").get(did, nonce) !== undefined;
  }

  add(did: string, nonce: string, expiresAt: number): void {
    this.db
      .prepare(
        "INSERT INTO relay_send_nonces (did, nonce, expires_at) VALUES (?, ?, ?) " +
          "ON CONFLICT (did, nonce) DO UPDATE SET expires_at = MAX(expires_at, excluded.expires_at)"
      )
      .run(did, nonce, expiresAt);
  }

  countFor(did: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM relay_send_nonces WHERE did = ?").get(did) as { n: number | bigint };
    return Number(row.n);
  }

  total(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM relay_send_nonces").get() as { n: number | bigint };
    return Number(row.n);
  }

  prune(now: number): void {
    this.db.prepare("DELETE FROM relay_send_nonces WHERE expires_at < ?").run(now);
  }

  /** Not part of SendNonceStore — closes the underlying connection; tests use this between restarts. */
  close(): void {
    this.db.close();
  }
}
