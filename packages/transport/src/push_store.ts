// push_store.ts — where the relay keeps each DID's one push subscription (web_push.ts). A phone hands it over on its
// AUTHENTICATED drain only (relay_server.ts handlePush), so a row can be written by the DID's owner alone. The row says
// nothing about the person: a push-service URL and two client keys, replaced whenever the phone re-subscribes, removed
// when the phone switches notifications off or the push service answers "gone".
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { PushSubscriptionJson } from "./web_push.js";

const requireCjs = createRequire(import.meta.url);
const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");

export interface PushSubscriptionStore {
  get(did: string): PushSubscriptionJson | null;
  set(did: string, sub: PushSubscriptionJson): void;
  remove(did: string): void;
  /** How many phones can be woken; for the status line only. */
  count(): number;
}

export class InMemoryPushSubscriptionStore implements PushSubscriptionStore {
  private readonly rows = new Map<string, PushSubscriptionJson>();
  get(did: string): PushSubscriptionJson | null {
    return this.rows.get(did) ?? null;
  }
  set(did: string, sub: PushSubscriptionJson): void {
    this.rows.set(did, sub);
  }
  remove(did: string): void {
    this.rows.delete(did);
  }
  count(): number {
    return this.rows.size;
  }
}

/** Lives in the same SQLite file as the queue (relay_only.ts passes the queue's path). */
export class SqlitePushSubscriptionStore implements PushSubscriptionStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS push_subs (did TEXT PRIMARY KEY, sub TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
  }

  get(did: string): PushSubscriptionJson | null {
    const row = this.db.prepare("SELECT sub FROM push_subs WHERE did = ?").get(did) as { sub: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.sub) as PushSubscriptionJson;
    } catch {
      return null;
    }
  }

  set(did: string, sub: PushSubscriptionJson): void {
    this.db
      .prepare("INSERT INTO push_subs (did, sub, updated_at) VALUES (?, ?, ?) ON CONFLICT(did) DO UPDATE SET sub = excluded.sub, updated_at = excluded.updated_at")
      .run(did, JSON.stringify(sub), Date.now());
  }

  remove(did: string): void {
    this.db.prepare("DELETE FROM push_subs WHERE did = ?").run(did);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM push_subs").get() as { n: number | bigint };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}
