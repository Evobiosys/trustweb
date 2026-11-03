// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// did_key_records — self-authenticating key records for a did:peer:2 identity (relay send-auth hardening F5/F6).
//
// A did:peer:2 IS its Ed25519 key, so on its own a leaked key is forever and a lost device takes the DID with it.
// These four signed statements let the key holder say, in a form any relay can check without asking anyone:
//
//   rotate        "trustweb-did-rotate/v1\n<did>\n<successorDid>\n<at>"
//                 sig by did's root key AND successorSig by successorDid's root key (both ends consent: nobody can
//                 rotate INTO a key they do not hold, and nobody can rotate a DID they do not hold)
//   revoke        "trustweb-did-revoke/v1\n<did>\n<at>"                       sig by did's root key; terminal
//   device_grant  "trustweb-did-device/v1\n<did>\n<kid>\n<at>\n<expiresAt>"   sig by root, kidSig by the device key
//                 (proof of possession); expiresAt defaults to at + 365 d (I9 conservative defaults)
//   device_revoke "trustweb-did-device-revoke/v1\n<did>\n<kid>\n<at>"        sig by root
//
// `kid` is the device's Ed25519 public key in the did:peer:2 V-element encoding (`z6Mk…`). Signatures are
// base64url (unpadded, 86 chars), times are ms since epoch. Pure: no I/O, no clock beyond the `at` default.
//
// HONEST LABELING (I7): a record proves what the key holder signed; it does not stop a thief who holds the root
// key from racing the owner with their own rotate/revoke. Revocation is the escape hatch for that race: it is
// terminal, so the owner can always at least kill a stolen DID. What a relay does with these records is in
// did_key_registry.ts.
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeEd25519Multibase, encodeEd25519Multibase, resolveDidPeer, type Identity, type KeyPair } from "./did_identity.js";

export const KEY_RECORD_PREFIXES = {
  rotate: "trustweb-did-rotate/v1",
  revoke: "trustweb-did-revoke/v1",
  device_grant: "trustweb-did-device/v1",
  device_revoke: "trustweb-did-device-revoke/v1",
} as const;

/** Default lifetime of a device grant (I9: edges and policies expire after a year unless renewed). */
export const DEFAULT_DEVICE_GRANT_MS = 365 * 24 * 60 * 60 * 1000;

export interface RotateRecord {
  type: "rotate";
  did: string;
  successorDid: string;
  at: number;
  sig: string;
  successorSig: string;
}
export interface RevokeRecord {
  type: "revoke";
  did: string;
  at: number;
  sig: string;
}
export interface DeviceGrantRecord {
  type: "device_grant";
  did: string;
  kid: string;
  at: number;
  expiresAt: number;
  sig: string;
  kidSig: string;
}
export interface DeviceRevokeRecord {
  type: "device_revoke";
  did: string;
  kid: string;
  at: number;
  sig: string;
}
export type KeyRecord = RotateRecord | RevokeRecord | DeviceGrantRecord | DeviceRevokeRecord;

/** The fields a signing input is built from (a record with or without its signatures). */
export type KeyRecordStatement =
  | Pick<RotateRecord, "type" | "did" | "successorDid" | "at">
  | Pick<RevokeRecord, "type" | "did" | "at">
  | Pick<DeviceGrantRecord, "type" | "did" | "kid" | "at" | "expiresAt">
  | Pick<DeviceRevokeRecord, "type" | "did" | "kid" | "at">;

type SigningIdentity = Pick<Identity, "did" | "signing">;

/** The exact text a record's signatures cover ("\n"-joined, see the file header). */
export function keyRecordSigningText(record: KeyRecordStatement): string {
  switch (record.type) {
    case "rotate":
      return [KEY_RECORD_PREFIXES.rotate, record.did, record.successorDid, String(record.at)].join("\n");
    case "revoke":
      return [KEY_RECORD_PREFIXES.revoke, record.did, String(record.at)].join("\n");
    case "device_grant":
      return [KEY_RECORD_PREFIXES.device_grant, record.did, record.kid, String(record.at), String(record.expiresAt)].join("\n");
    case "device_revoke":
      return [KEY_RECORD_PREFIXES.device_revoke, record.did, record.kid, String(record.at)].join("\n");
  }
}

/** UTF-8 bytes of keyRecordSigningText — what every signature in a record is made over. */
export function keyRecordSigningInput(record: KeyRecordStatement): Uint8Array {
  return new TextEncoder().encode(keyRecordSigningText(record));
}

function sign(input: Uint8Array, secretKey: Uint8Array): string {
  return Buffer.from(ed25519.sign(input, secretKey)).toString("base64url");
}

/** `old` hands its DID over to `next`. Both root keys sign the same statement. */
export function signRotation(old: SigningIdentity, next: SigningIdentity, at: number = Date.now()): RotateRecord {
  const statement = { type: "rotate" as const, did: old.did, successorDid: next.did, at };
  const input = keyRecordSigningInput(statement);
  return { ...statement, sig: sign(input, old.signing.secretKey), successorSig: sign(input, next.signing.secretKey) };
}

/** Terminal: after this no key (root or device) speaks for `id.did` again. */
export function signRevocation(id: SigningIdentity, at: number = Date.now()): RevokeRecord {
  const statement = { type: "revoke" as const, did: id.did, at };
  return { ...statement, sig: sign(keyRecordSigningInput(statement), id.signing.secretKey) };
}

/** The root key authorises `device` to sign for `id.did` until expiresAt (default at + 365 d); the device proves possession. */
export function signDeviceGrant(
  id: SigningIdentity,
  device: KeyPair,
  opts: { at?: number; expiresAt?: number } = {}
): DeviceGrantRecord {
  const at = opts.at ?? Date.now();
  const statement = {
    type: "device_grant" as const,
    did: id.did,
    kid: encodeEd25519Multibase(device.publicKey),
    at,
    expiresAt: opts.expiresAt ?? at + DEFAULT_DEVICE_GRANT_MS,
  };
  const input = keyRecordSigningInput(statement);
  return { ...statement, sig: sign(input, id.signing.secretKey), kidSig: sign(input, device.secretKey) };
}

/** The root key withdraws one device key (terminal for that kid). */
export function signDeviceRevocation(id: SigningIdentity, kid: string, at: number = Date.now()): DeviceRevokeRecord {
  const statement = { type: "device_revoke" as const, did: id.did, kid, at };
  return { ...statement, sig: sign(keyRecordSigningInput(statement), id.signing.secretKey) };
}

// ---- parsing ----------------------------------------------------------------

const MAX_DID_LENGTH = 4096;
const MAX_KID_LENGTH = 128;
const SIG_PATTERN = /^[A-Za-z0-9_-]{86}$/; // 64 bytes, unpadded base64url
/** Printable ASCII without spaces: keeps every field a single line of the signing input. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

function isTime(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isDidPeer2(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_DID_LENGTH || !TOKEN_PATTERN.test(v)) return false;
  try {
    resolveDidPeer(v);
    return true;
  } catch {
    return false;
  }
}

function isKid(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_KID_LENGTH || !TOKEN_PATTERN.test(v)) return false;
  try {
    decodeEd25519Multibase(v);
    return true;
  } catch {
    return false;
  }
}

function isSig(v: unknown): v is string {
  return typeof v === "string" && SIG_PATTERN.test(v);
}

/**
 * Structural parse of a statement WITHOUT its signatures: every field a signature would cover is well formed.
 * DidKeyRegistry uses this to tell "malformed" (400) from "signature missing or wrong" (401).
 */
export function parseKeyRecordStatement(input: unknown): KeyRecordStatement | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!isDidPeer2(r.did) || !isTime(r.at)) return null;
  switch (r.type) {
    case "rotate":
      return isDidPeer2(r.successorDid) ? { type: "rotate", did: r.did, successorDid: r.successorDid, at: r.at } : null;
    case "revoke":
      return { type: "revoke", did: r.did, at: r.at };
    case "device_grant":
      return isKid(r.kid) && isTime(r.expiresAt) && r.expiresAt > r.at
        ? { type: "device_grant", did: r.did, kid: r.kid, at: r.at, expiresAt: r.expiresAt }
        : null;
    case "device_revoke":
      return isKid(r.kid) ? { type: "device_revoke", did: r.did, kid: r.kid, at: r.at } : null;
    default:
      return null;
  }
}

/**
 * Zod-free structural parse of a key record (an object, or its JSON text). Returns null for anything that is not
 * exactly one of the four record shapes with well-formed fields and signatures. Extra fields are dropped. Never
 * throws. It does NOT verify signatures — DidKeyRegistry.apply does.
 */
export function parseKeyRecord(input: unknown): KeyRecord | null {
  const statement = parseKeyRecordStatement(input);
  if (!statement) return null;
  const r = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown>;
  if (!isSig(r.sig)) return null;
  switch (statement.type) {
    case "rotate":
      return isSig(r.successorSig) ? { ...statement, sig: r.sig, successorSig: r.successorSig } : null;
    case "device_grant":
      return isSig(r.kidSig) ? { ...statement, sig: r.sig, kidSig: r.kidSig } : null;
    case "revoke":
    case "device_revoke":
      return { ...statement, sig: r.sig };
  }
}
