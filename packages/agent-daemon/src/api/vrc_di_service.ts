// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Keyring-compatible VRC export/import for the REST surface (GET /api/trust/export?peer=, POST /api/trust/import).
// Identity: each edge exports under its OWN relationship key (did:peer:0, key only); the device did:peer:2 never leaves
// the daemon. Keys are minted on first export and kept per edge (alpha: plaintext JSON, mode 0600, like the device identity file).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

export interface RelationshipKeyStore {
  /** The one relationship key of this edge; minted on first use. */
  getOrCreate(edgePeer: string): RelationshipKey;
}

export class MemoryRelationshipKeyStore implements RelationshipKeyStore {
  protected readonly keys = new Map<string, RelationshipKey>();
  getOrCreate(edgePeer: string): RelationshipKey {
    let key = this.keys.get(edgePeer);
    if (!key) {
      key = createRelationshipKey();
      this.keys.set(edgePeer, key);
    }
    return key;
  }
}

export class FileRelationshipKeyStore extends MemoryRelationshipKeyStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      for (const [peer, json] of Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, string>)) {
        this.keys.set(peer, relationshipKeyFromJson(json));
      }
    }
  }
  override getOrCreate(edgePeer: string): RelationshipKey {
    const known = this.keys.has(edgePeer);
    const key = super.getOrCreate(edgePeer);
    if (!known) {
      mkdirSync(dirname(this.path), { recursive: true });
      const all = Object.fromEntries([...this.keys].map(([peer, k]) => [peer, relationshipKeyToJson(k)]));
      writeFileSync(this.path, JSON.stringify(all, null, 2), { encoding: "utf8", mode: 0o600 });
    }
    return key;
  }
}

/** An error the REST layer maps to its HTTP status. */
export class VrcDiError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export interface VrcDiService {
  exportFor(peer: string, subject?: string): Promise<DiVrc>;
  verify: typeof importVrcDi;
}

export interface VrcDiServiceDeps {
  store: { getTrustEdge(peer: string): TrustEdge | undefined };
  keys: RelationshipKeyStore;
  now?: () => Date;
}

export function createVrcDiService({ store, keys, now = () => new Date() }: VrcDiServiceDeps): VrcDiService {
  return {
    async exportFor(peer, subject) {
      const edge = store.getTrustEdge(peer);
      if (!edge) throw new VrcDiError(404, `no trust edge for ${peer}`);
      // The credential names the counterparty's RELATIONSHIP DID: the edge peer when it already is one, else the caller's.
      const subjectDid = subject ?? (peer.startsWith("did:peer:0") ? peer : undefined);
      if (!subjectDid) throw new VrcDiError(400, "the counterparty's relationship DID is unknown: pass subject=<did:peer:0…>");
      try {
        return await exportVrcDi(keys.getOrCreate(peer), { subjectDid, validFrom: now().toISOString(), validUntil: edge.expires_at });
      } catch (err) {
        throw new VrcDiError(400, (err as Error).message);
      }
    },
    verify: importVrcDi,
  };
}
