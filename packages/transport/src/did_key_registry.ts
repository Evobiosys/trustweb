// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// DidKeyRegistry — which key speaks for a did:peer:2 right now (relay send-auth hardening F5/F6).
//
// A relay applies the self-authenticating records of did_key_records.ts (POST /relay/keys) and consults this
// registry for BOTH sender auth (it is the SendKeyPolicy handed to relay_send_auth.ts's SendAuthVerifier) and drain
// auth (relay_server.ts handleAuth). Nobody is trusted: every record carries the signatures that justify it.
//
// Rules (fail closed; apply() never throws):
//   - revoked is terminal: no further records for that DID (401 revoked), and it can never be a successor
//     (409 successor_unavailable); its root and device keys resolve "revoked".
//   - rotated is terminal for the old DID: no further records (401 rotated); its keys resolve "rotated", its device
//     grants die with it (the successor re-grants). The successor must be active, must not be the DID itself nor
//     any of its predecessors (409 cycle).
//   - a record dated beyond now + windowMs is 400 future_record; one older than the stored state of the same
//     subject (the DID, or the DID+kid for device records) is 409 stale_record; the identical record (same signed
//     statement) again is { ok: true, applied: false }.
//   - device grants only for an active DID, with the device key's proof of possession; a device_revoke for a kid
//     never granted is 409 unknown_grant; a revoked kid stays revoked (a later grant for it → 401 revoked).
//
// HONEST LABELING (I7): the registry is per relay. A record applied at one relay is unknown at another until it is
// posted there too, and a holder of a leaked root key can race the owner (first valid record wins). Revocation is
// the owner's backstop. Nothing here makes the relay forget the sender DID it learns from a signed send.
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeEd25519Multibase, resolveDidPeer } from "./did_identity.js";
import { keyRecordSigningInput, keyRecordSigningText, parseKeyRecord, parseKeyRecordStatement, type KeyRecord } from "./did_key_records.js";
import { InMemoryDidKeyStore, type DidKeyStore } from "./did_key_store.js";
import type { KeyLookup, SendKeyPolicy } from "./relay_send_auth.js";

export type ApplyFailureCode =
  | "malformed"
  | "bad_signature"
  | "revoked"
  | "rotated"
  | "stale_record"
  | "future_record"
  | "cycle"
  | "successor_unavailable"
  | "unknown_grant";

export type ApplyResult = { ok: true; applied: boolean } | { ok: false; status: 400 | 401 | 409; code: ApplyFailureCode };

export interface DidKeyRegistryOptions {
  store?: DidKeyStore;
  now?: () => number;
  /** How far in the future a record's `at` may lie (clock skew tolerance). Default 5 minutes. */
  windowMs?: number;
}

export interface DidKeyStatus {
  state: "active" | "rotated" | "revoked";
  successorDid?: string;
  at?: number;
}

export const DEFAULT_KEY_RECORD_WINDOW_MS = 5 * 60_000;
/** Bound on successor / predecessor walks (a chain longer than this is not followed further). */
const MAX_HOPS = 32;
/** Bound on the total predecessors returned (a successor can have several direct predecessors). */
const MAX_PREDECESSORS = 256;

const APPLIED: ApplyResult = { ok: true, applied: true };
const UNCHANGED: ApplyResult = { ok: true, applied: false };

function fail(status: 400 | 401 | 409, code: ApplyFailureCode): ApplyResult {
  return { ok: false, status, code };
}

function verifySig(sig: string, input: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(new Uint8Array(Buffer.from(sig, "base64url")), input, publicKey);
  } catch {
    return false;
  }
}

function rootKey(did: string): Uint8Array | null {
  try {
    return resolveDidPeer(did).signingPublicKey;
  } catch {
    return null;
  }
}

export class DidKeyRegistry implements SendKeyPolicy {
  private readonly store: DidKeyStore;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(opts: DidKeyRegistryOptions = {}) {
    this.store = opts.store ?? new InMemoryDidKeyStore();
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? DEFAULT_KEY_RECORD_WINDOW_MS;
  }

  /** Apply one record (object or JSON text). Never throws. */
  apply(input: unknown): ApplyResult {
    try {
      return this.applyUnsafe(input);
    } catch {
      // a store failure must not turn into an accepted record
      return fail(400, "malformed");
    }
  }

  private applyUnsafe(input: unknown): ApplyResult {
    const record = parseKeyRecord(input);
    if (!record) {
      // well-formed statement whose signature field is missing or not a signature: a signature failure, not a shape one
      return parseKeyRecordStatement(input) ? fail(401, "bad_signature") : fail(400, "malformed");
    }
    if (record.at > this.now() + this.windowMs) return fail(400, "future_record");
    if (!this.signaturesVerify(record)) return fail(401, "bad_signature");

    const text = keyRecordSigningText(record);
    const subject = this.store.getDid(record.did);

    if (record.type === "rotate" || record.type === "revoke") {
      if (subject) {
        if (subject.input === text) return UNCHANGED;
        return fail(401, subject.state);
      }
      if (record.type === "rotate") {
        if (record.successorDid === record.did || this.predecessors(record.did).includes(record.successorDid)) {
          return fail(409, "cycle");
        }
        if (this.store.getDid(record.successorDid)) return fail(409, "successor_unavailable");
        this.store.putDid({
          did: record.did,
          state: "rotated",
          successorDid: record.successorDid,
          at: record.at,
          input: text,
          record: JSON.stringify(record),
        });
      } else {
        this.store.putDid({ did: record.did, state: "revoked", at: record.at, input: text, record: JSON.stringify(record) });
      }
      return APPLIED;
    }

    const grant = this.store.getGrant(record.did, record.kid);
    if (record.type === "device_grant") {
      if (grant?.grantInput === text) return UNCHANGED;
      if (subject) return fail(401, subject.state);
      if (grant) {
        if (grant.revokedAt !== undefined) return fail(401, "revoked");
        if (record.at <= grant.at) return fail(409, "stale_record");
      }
      this.store.putGrant({
        did: record.did,
        kid: record.kid,
        at: record.at,
        expiresAt: record.expiresAt,
        grantInput: text,
        record: JSON.stringify(record),
      });
      return APPLIED;
    }

    // device_revoke
    if (grant?.revokeInput === text) return UNCHANGED;
    if (subject) return fail(401, subject.state);
    if (!grant) return fail(409, "unknown_grant");
    if (grant.revokedAt !== undefined) return fail(401, "revoked");
    if (record.at < grant.at) return fail(409, "stale_record");
    this.store.putGrant({ ...grant, revokedAt: record.at, revokeInput: text });
    return APPLIED;
  }

  private signaturesVerify(record: KeyRecord): boolean {
    const input = keyRecordSigningInput(record);
    const root = rootKey(record.did);
    if (!root || !verifySig(record.sig, input, root)) return false;
    if (record.type === "rotate") {
      const successor = rootKey(record.successorDid);
      return successor !== null && verifySig(record.successorSig, input, successor);
    }
    if (record.type === "device_grant") {
      try {
        return verifySig(record.kidSig, input, decodeEd25519Multibase(record.kid));
      } catch {
        return false;
      }
    }
    return true;
  }

  /** SendKeyPolicy: the public key that may sign for `did` (root when kid is undefined, else that device key). Never throws. */
  signingKeyFor(did: string, kid: string | undefined, now: number): KeyLookup {
    try {
      const row = this.store.getDid(did);
      if (row) return { ok: false, code: row.state };
      if (kid === undefined) {
        const root = rootKey(did);
        return root ? { ok: true, publicKey: root } : { ok: false, code: "unknown_key" };
      }
      const grant = this.store.getGrant(did, kid);
      if (!grant) return { ok: false, code: "unknown_key" };
      if (grant.revokedAt !== undefined) return { ok: false, code: "revoked" };
      if (grant.expiresAt <= now) return { ok: false, code: "expired_key" };
      return { ok: true, publicKey: decodeEd25519Multibase(kid) };
    } catch {
      return { ok: false, code: "unknown_key" };
    }
  }

  status(did: string): DidKeyStatus {
    const row = this.store.getDid(did);
    if (!row) return { state: "active" };
    return { state: row.state, ...(row.successorDid !== undefined ? { successorDid: row.successorDid } : {}), at: row.at };
  }

  /** Follow successors from `did` to the DID that currently speaks for it (at most MAX_HOPS hops). */
  canonical(did: string): string {
    let current = did;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const row = this.store.getDid(current);
      if (!row || row.state !== "rotated" || row.successorDid === undefined) return current;
      current = row.successorDid;
    }
    return current;
  }

  /** Every DID that rotated (transitively) into `did`, nearest first (breadth-first), bounded. */
  predecessors(did: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([did]);
    let frontier = [did];
    for (let depth = 0; depth < MAX_HOPS && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const d of frontier) {
        for (const p of this.store.predecessorsOf(d)) {
          if (seen.has(p)) continue;
          seen.add(p);
          out.push(p);
          next.push(p);
          if (out.length >= MAX_PREDECESSORS) return out;
        }
      }
      frontier = next;
    }
    return out;
  }

  /** The device keys ever granted for `did` (including expired and revoked ones). */
  deviceKeys(did: string): Array<{ kid: string; expiresAt: number; revokedAt?: number }> {
    return this.store
      .listGrants(did)
      .map((g) => ({ kid: g.kid, expiresAt: g.expiresAt, ...(g.revokedAt !== undefined ? { revokedAt: g.revokedAt } : {}) }));
  }
}
