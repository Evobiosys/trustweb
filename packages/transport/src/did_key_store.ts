// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// DidKeyStore — persistence for did_key_registry.ts (relay send-auth hardening F5/F6).
//
// Holds only what a relay needs to answer "which key speaks for this DID right now": a row per DID that is NO
// LONGER plain active (rotated → successor, or revoked), and a row per device grant. A DID with no row is active
// and its key is the one inside its did:peer:2 string. Each row keeps the signing text of the record that set it
// (identical-record detection) and the record JSON itself (I6: what the relay acted on stays readable locally).
// No row is ever deleted: rotation and revocation are terminal, and a revoked grant keeps its revokedAt.
//
// SqliteDidKeyStore mirrors relay_queue_store.ts's node:sqlite access pattern (createRequire, no native
// dependency, DECISIONS.md D6) and may share the queue's db file (relay_only.ts does).
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const requireCjs = createRequire(import.meta.url);
const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");

/** A DID that has left the active state. */
export interface DidStateRow {
  did: string;
  state: "rotated" | "revoked";
  /** Set when state is "rotated". */
  successorDid?: string;
  /** The `at` of the record that set this state. */
  at: number;
  /** keyRecordSigningText of that record. */
  input: string;
  /** The record as JSON (audit). */
  record: string;
}

/** One device key granted by a DID's root key. */
export interface DeviceGrantRow {
  did: string;
  kid: string;
  /** `at` of the newest applied grant for this kid. */
  at: number;
  expiresAt: number;
  /** keyRecordSigningText of the newest applied grant. */
  grantInput: string;
  record: string;
  revokedAt?: number;
  /** keyRecordSigningText of the device_revoke, when revoked. */
  revokeInput?: string;
}

export interface DidKeyStore {
  getDid(did: string): DidStateRow | undefined;
  putDid(row: DidStateRow): void;
  /** DIDs whose rotation names `successorDid` (direct predecessors only), oldest first. */
  predecessorsOf(successorDid: string): string[];
  getGrant(did: string, kid: string): DeviceGrantRow | undefined;
  putGrant(row: DeviceGrantRow): void;
  listGrants(did: string): DeviceGrantRow[];
  close(): void;
}

/** Default store: lost on restart (tests, and RelayServer instances that do not persist). */
export class InMemoryDidKeyStore implements DidKeyStore {
  private readonly dids = new Map<string, DidStateRow>();
  private readonly grants = new Map<string, DeviceGrantRow>();

  getDid(did: string): DidStateRow | undefined {
    const row = this.dids.get(did);
    return row ? { ...row } : undefined;
  }

  putDid(row: DidStateRow): void {
    this.dids.delete(row.did); // keep Map order = write order, so predecessorsOf is oldest first
    this.dids.set(row.did, { ...row });
  }

  predecessorsOf(successorDid: string): string[] {
    const out: string[] = [];
    for (const row of this.dids.values()) if (row.state === "rotated" && row.successorDid === successorDid) out.push(row.did);
    return out;
  }

  getGrant(did: string, kid: string): DeviceGrantRow | undefined {
    const row = this.grants.get(`${did}\n${kid}`);
    return row ? { ...row } : undefined;
  }

  putGrant(row: DeviceGrantRow): void {
    this.grants.set(`${row.did}\n${row.kid}`, { ...row });
  }

  listGrants(did: string): DeviceGrantRow[] {
    const out: DeviceGrantRow[] = [];
    for (const row of this.grants.values()) if (row.did === did) out.push({ ...row });
    return out;
  }

  close(): void {
    // nothing to release
  }
}

interface DidSqlRow {
  did: string;
  state: string;
  successor_did: string | null;
  at: number | bigint;
  input: string;
  record: string;
}

interface GrantSqlRow {
  did: string;
  kid: string;
  at: number | bigint;
  expires_at: number | bigint;
  grant_input: string;
  record: string;
  revoked_at: number | bigint | null;
  revoke_input: string | null;
}

function didFromSql(r: DidSqlRow): DidStateRow {
  return {
    did: r.did,
    state: r.state === "revoked" ? "revoked" : "rotated",
    ...(r.successor_did !== null ? { successorDid: r.successor_did } : {}),
    at: Number(r.at),
    input: r.input,
    record: r.record,
  };
}

function grantFromSql(r: GrantSqlRow): DeviceGrantRow {
  return {
    did: r.did,
    kid: r.kid,
    at: Number(r.at),
    expiresAt: Number(r.expires_at),
    grantInput: r.grant_input,
    record: r.record,
    ...(r.revoked_at !== null ? { revokedAt: Number(r.revoked_at) } : {}),
    ...(r.revoke_input !== null ? { revokeInput: r.revoke_input } : {}),
  };
}

/** SQLite-backed: rotations, revocations and grants survive a relay restart (a revoked key must stay revoked). */
export class SqliteDidKeyStore implements DidKeyStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS relay_did_keys (" +
        "did TEXT PRIMARY KEY, " +
        "state TEXT NOT NULL, " +
        "successor_did TEXT, " +
        "at INTEGER NOT NULL, " +
        "input TEXT NOT NULL, " +
        "record TEXT NOT NULL, " +
        "written INTEGER NOT NULL" +
        ")"
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS relay_did_keys_successor ON relay_did_keys (successor_did)");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS relay_did_device_keys (" +
        "did TEXT NOT NULL, " +
        "kid TEXT NOT NULL, " +
        "at INTEGER NOT NULL, " +
        "expires_at INTEGER NOT NULL, " +
        "grant_input TEXT NOT NULL, " +
        "record TEXT NOT NULL, " +
        "revoked_at INTEGER, " +
        "revoke_input TEXT, " +
        "PRIMARY KEY (did, kid)" +
        ")"
    );
  }

  getDid(did: string): DidStateRow | undefined {
    const row = this.db
      .prepare("SELECT did, state, successor_did, at, input, record FROM relay_did_keys WHERE did = ?")
      .get(did) as DidSqlRow | undefined;
    return row ? didFromSql(row) : undefined;
  }

  putDid(row: DidStateRow): void {
    const written = this.db.prepare("SELECT COALESCE(MAX(written), 0) + 1 AS n FROM relay_did_keys").get() as { n: number | bigint };
    this.db
      .prepare(
        "INSERT OR REPLACE INTO relay_did_keys (did, state, successor_did, at, input, record, written) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(row.did, row.state, row.successorDid ?? null, row.at, row.input, row.record, Number(written.n));
  }

  predecessorsOf(successorDid: string): string[] {
    const rows = this.db
      .prepare("SELECT did FROM relay_did_keys WHERE successor_did = ? AND state = 'rotated' ORDER BY written ASC")
      .all(successorDid) as { did: string }[];
    return rows.map((r) => r.did);
  }

  getGrant(did: string, kid: string): DeviceGrantRow | undefined {
    const row = this.db
      .prepare(
        "SELECT did, kid, at, expires_at, grant_input, record, revoked_at, revoke_input FROM relay_did_device_keys WHERE did = ? AND kid = ?"
      )
      .get(did, kid) as GrantSqlRow | undefined;
    return row ? grantFromSql(row) : undefined;
  }

  putGrant(row: DeviceGrantRow): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO relay_did_device_keys (did, kid, at, expires_at, grant_input, record, revoked_at, revoke_input) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(row.did, row.kid, row.at, row.expiresAt, row.grantInput, row.record, row.revokedAt ?? null, row.revokeInput ?? null);
  }

  listGrants(did: string): DeviceGrantRow[] {
    const rows = this.db
      .prepare(
        "SELECT did, kid, at, expires_at, grant_input, record, revoked_at, revoke_input FROM relay_did_device_keys WHERE did = ? ORDER BY at ASC, kid ASC"
      )
      .all(did) as unknown as GrantSqlRow[];
    return rows.map(grantFromSql);
  }

  close(): void {
    this.db.close();
  }
}
