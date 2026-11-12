// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Keyring-compatible VRC export/import for the REST surface (GET /api/trust/export?peer=, POST /api/trust/import).
// Identity: each edge exports under its OWN relationship key (did:peer:0, key only); the device did:peer:2 never leaves
// the daemon. Keys are minted on first export and kept per edge (alpha: plaintext JSON, mode 0600, like the device identity
// file; sealing them in the vault is a later step, DECISIONS.md).
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TrustEdge } from "@resource-web/protocol";
import {
  createRelationshipKey,
  exportVrcDi,
  importVrcDi,
  relationshipKeyFromJson,
  relationshipKeyToJson,
  type DiVrc,
  type RelationshipKey,
} from "@resource-web/transport/vrc_di";
import { logOwner } from "../audit/audit.js";
import type { Store } from "../store/store.js";

export interface RelationshipKeyStore {
  /** The one relationship key of this edge; minted on first use. */
  getOrCreate(edgePeer: string): RelationshipKey;
  has(edgePeer: string): boolean;
  /** Every relationship DID this wallet minted. */
  all(): string[];
  /** Messages for the owner's audit log (I6) that arose while loading (e.g. a quarantined file); returned once. */
  takeNotices(): string[];
}

export class MemoryRelationshipKeyStore implements RelationshipKeyStore {
  protected readonly keys = new Map<string, RelationshipKey>();
  protected notices: string[] = [];
  getOrCreate(edgePeer: string): RelationshipKey {
    let key = this.keys.get(edgePeer);
    if (!key) {
      key = createRelationshipKey();
      this.keys.set(edgePeer, key);
    }
    return key;
  }
  has(edgePeer: string): boolean {
    return this.keys.has(edgePeer);
  }
  all(): string[] {
    return [...this.keys.values()].map((k) => k.did);
  }
  takeNotices(): string[] {
    const out = this.notices;
    this.notices = [];
    return out;
  }
}

const OPEN_STORES = new Map<string, FileRelationshipKeyStore>();

export class FileRelationshipKeyStore extends MemoryRelationshipKeyStore {
  /** One instance per path: two caches on one file would let the last write drop the other's new key. */
  static open(path: string): FileRelationshipKeyStore {
    const abs = resolve(path);
    let store = OPEN_STORES.get(abs);
    if (!store) {
      store = new FileRelationshipKeyStore(abs);
      OPEN_STORES.set(abs, store);
    }
    return store;
  }

  constructor(private readonly path: string) {
    super();
    this.load();
  }

  /** Merges the readable entries of the file into the cache; a bad file or entry is copied to relationships.json.corrupt-<ts> first. */
  private load(): void {
    if (!existsSync(this.path)) return;
    chmodSync(this.path, 0o600);
    let bad = 0;
    let entries: [string, unknown][] = [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      entries = Object.entries(parsed);
    } catch {
      bad = 1;
    }
    for (const [peer, json] of entries) {
      if (this.keys.has(peer)) continue;
      try {
        if (typeof json !== "string") throw new Error("entry is not a string");
        this.keys.set(peer, relationshipKeyFromJson(json));
      } catch {
        bad += 1;
      }
    }
    if (bad > 0) {
      const copy = `${this.path}.corrupt-${Date.now()}`;
      copyFileSync(this.path, copy);
      chmodSync(copy, 0o600);
      this.notices.push(`relationship key file had ${bad} unreadable part(s); original quarantined to ${copy}, continuing with ${this.keys.size} readable key(s)`);
      this.save();
    }
  }

  override getOrCreate(edgePeer: string): RelationshipKey {
    if (this.keys.has(edgePeer)) return super.getOrCreate(edgePeer);
    this.load(); // another instance may have minted keys since we read the file
    const known = this.keys.has(edgePeer);
    const key = super.getOrCreate(edgePeer);
    if (!known) this.save();
    return key;
  }

  /** tmp file (0600) in the same directory, fsync, rename: a crash leaves the old file or the new one, never half. */
  private save(): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const all = Object.fromEntries([...this.keys].map(([peer, k]) => [peer, relationshipKeyToJson(k)]));
    const tmp = `${this.path}.tmp-${process.pid}`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(all, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}

/** An error the REST layer maps to its HTTP status. */
export class VrcDiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

export interface VerifiedImport {
  issuer: string;
  subject: string;
}

export interface VrcDiService {
  exportFor(peer: string, subject?: string): Promise<DiVrc>;
  /** Verifies a VRC and runs every check that must pass before a card opens; throws VrcDiError (400/409/429). */
  checkImport(vrc: unknown): Promise<VerifiedImport>;
}

export interface VrcDiServiceDeps {
  store: Store;
  keys: RelationshipKeyStore;
  now?: () => Date;
}

export const MAX_PENDING_VRC_CARDS = 50;
const DECLINE_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_ID = "vrc-di";
const HASH_PREFIX = "credential sha256 ";

export function createVrcDiService({ store, keys, now = () => new Date() }: VrcDiServiceDeps): VrcDiService {
  const clock = { now };
  const log = (action: string, detail: string): void => logOwner(store, clock, AUDIT_ID, action, detail);
  for (const notice of keys.takeNotices()) log("relationship_keys_quarantined", notice);
  // credential hashes seen before live in the audit log, so a replay stays refused after a restart
  const seen = new Set<string>();
  for (const a of store.getAudit()) {
    if (a.action === "vrc_import_accepted") seen.add(a.detail.split(HASH_PREFIX)[1]?.slice(0, 64) ?? "");
  }
  const refuse = (status: 400 | 409 | 429, reason: string, issuer?: string): never => {
    log("vrc_import_refused", `VRC import refused: ${reason}${issuer ? ` (issuer ${issuer})` : ""}`);
    throw new VrcDiError(status, reason);
  };

  return {
    async exportFor(peer, subject) {
      const edge = store.getTrustEdge(peer);
      if (!edge) throw new VrcDiError(404, `no trust edge for ${peer}`);
      // The credential names the counterparty's RELATIONSHIP DID: the edge peer when it already is one, else the caller's.
      const subjectDid = subject ?? (peer.startsWith("did:peer:0") ? peer : undefined);
      if (!subjectDid) throw new VrcDiError(400, "the counterparty's relationship DID is unknown: pass subject=<did:peer:0…>");
      const validFrom = now();
      const expires = Date.parse(edge.expires_at);
      if (!Number.isFinite(expires) || expires <= validFrom.getTime()) throw new VrcDiError(400, "edge expired");
      const minted = !keys.has(peer);
      const key = keys.getOrCreate(peer);
      if (minted) log("relationship_key_minted", `relationship key minted for ${peer}: ${key.did}`);
      try {
        const vrc = await exportVrcDi(key, { subjectDid, validFrom: validFrom.toISOString(), validUntil: edge.expires_at });
        log("vrc_exported", `VRC exported for ${peer} to ${subjectDid} (issuer ${key.did}, valid until ${edge.expires_at})`);
        return vrc;
      } catch (err) {
        throw new VrcDiError(400, (err as Error).message);
      }
    },

    async checkImport(vrc) {
      const result = await importVrcDi(vrc, { now: now() });
      if (!result.valid || result.issuer === undefined || result.subject === undefined) return refuse(400, result.reason ?? "invalid VRC");
      const { issuer, subject } = result;
      const mine = keys.all();
      if (mine.includes(issuer)) return refuse(400, "credential issued by one of our own relationship keys", issuer);
      if (!mine.includes(subject)) return refuse(400, "credential not addressed to this wallet", issuer);
      if (store.getTrustEdge(issuer)) return refuse(409, "a trust edge for this issuer already exists", issuer);
      const hash = createHash("sha256").update((vrc as DiVrc).proof.proofValue).digest("hex");
      if (seen.has(hash)) return refuse(409, "this credential was already imported", issuer);
      const cards = store.getConnects().filter((c) => c.direction === "inbound" && c.peer.startsWith("did:peer:0"));
      const declinedAt = cards.filter((c) => c.peer === issuer && c.state === "declined").map((c) => Date.parse(c.created_at));
      if (declinedAt.some((t) => now().getTime() - t < DECLINE_MEMORY_MS)) return refuse(409, "this issuer was declined recently", issuer);
      if (cards.filter((c) => c.state === "pending").length >= MAX_PENDING_VRC_CARDS) return refuse(429, "too many pending VRC cards: decide on some first", issuer);
      seen.add(hash);
      log("vrc_import_accepted", `VRC accepted for a connect card from ${issuer} about ${subject}; ${HASH_PREFIX}${hash}`);
      return { issuer, subject };
    },
  };
}
