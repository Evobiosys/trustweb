/**
 * The holder's central-layer signing key, and the signatures it makes over
 * withdraw and clear (decision B-20, option A, 2026-09-06).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Before this, `DELETE /declarations/:id` and `POST /clear` acted on a plain id
 * or `authorCommitment` with no proof of holdership. An `authorCommitment` is a
 * salted SHA-256 of the holder DID: deterministic, equality-comparable, and
 * therefore NOT a secret. Anyone who had ever seen one could have wiped that
 * holder's declarations. Now every such request carries an Ed25519 signature
 * over a canonical message, verified against the key registered with the
 * declaration at publish time.
 *
 * ---------------------------------------------------------------------------
 * WHICH CRYPTO, AND WHY THE FALLBACK
 * ---------------------------------------------------------------------------
 * PRIMARY: Web Crypto Ed25519, with a NON-EXTRACTABLE private key. The key
 * object can sign but its bytes cannot be read back out, not by this code and
 * not by anything else running in the page -- which is strictly better than the
 * device identity in `../did.ts`, whose Ed25519 secret is stored as base64url
 * plaintext and says so in its own header ("a production build must move this
 * behind a non-exportable key").
 *
 * FALLBACK: @noble/curves' Ed25519, the crypto this repo already signs with
 * (`../did.ts`'s `signChallenge`, verified server-side by `packages/transport`'s
 * `resolveDidPeer`). Web Crypto's Ed25519 is recent -- Safari 17+, Chrome 137+,
 * Node 18.4+ -- so a browser that lacks it would otherwise be unable to withdraw
 * anything at all. The two are wire-identical (raw 32-byte public key, raw
 * 64-byte signature) and interoperate in both directions; `central_signing.test.ts`
 * proves it rather than assuming it. HONEST LABELLING (I7): on the fallback path
 * the private key is stored as bytes, exactly like the device identity, and
 * `backend` says which path a device is on so a UI can tell the truth about it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE KEY LIVES
 * ---------------------------------------------------------------------------
 * In `db.ts`'s key/value store, the same place `DeviceState.relayIdentity` is
 * persisted. (The handover's "the way pair keys are" does not resolve cleanly:
 * a pair key is DERIVED on demand by `main.ts`'s `pairKey()` and never
 * persisted at all. The real analogue for a long-lived device key is the relay
 * identity record, so that is what this mirrors.) On a hardened browser where
 * IndexedDB is blocked, `db.ts` degrades to an in-process Map: the key then
 * lives for the session only, and a holder who publishes and then reloads
 * cannot withdraw. Named here rather than hidden -- see the handover's
 * "Signing scheme" section, threat notes.
 *
 * GENERATED ON FIRST PUBLISH, never at boot. `client.ts` calls
 * `getOrCreateSigningKey()` only after `centralMode()` has returned `'on'` AND
 * the residency gate has passed, so a device with the central layer off never
 * mints a key at all.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { kvDel, kvGet, kvSet } from '../db'
import { fromB64u, randomBytes, toB64u } from '../crypto'

/** Domain separation. Must equal `@resource-web/wot-policy`'s constant of the
 *  same name; see `canonicalActionString` below on why this is mirrored rather
 *  than imported. */
export const SIGNED_ACTION_DOMAIN = 'ew-central-signed-action-v1'

/** Mirrors the server's `SIGNATURE_MAX_TTL_MS`. A signature this device makes
 *  is valid for one minute, comfortably inside the server's two-minute ceiling
 *  and short enough that a captured request is worth little. */
export const SIGNATURE_TTL_MS = 60_000

/** The literal `target` a clear-everything action carries. */
export const CLEAR_ALL_TARGET = 'all'

/** Where the device's central signing key is persisted, via `db.ts`. */
export const SIGNING_KEY_STORAGE_KEY = 'central.signing-key.v1'

export type SigningBackend = 'webcrypto-ed25519' | 'noble-ed25519'

export type SignedActionKind = 'withdraw' | 'clear'

export interface SignedActionPayload {
  action: SignedActionKind
  target: string
  authorCommitment: string
  nonce: string
  expiresAt: number
}

export interface SignedActionRequest {
  payload: SignedActionPayload
  signature: string
  publicKey: string
}

export interface CentralSigningKey {
  /** base64url over the raw 32 bytes: what gets registered at publish time. */
  publicKeyB64u: string
  /** Which crypto path this device ended up on. Honest labelling, I7. */
  backend: SigningBackend
  sign(message: Uint8Array): Promise<Uint8Array>
}

// ---------------------------------------------------------------------------
// Canonicalisation -- mirrors @resource-web/wot-policy byte for byte
// ---------------------------------------------------------------------------

/**
 * The exact string this device signs, and the exact string the server
 * verifies.
 *
 * Mirrored from `@resource-web/wot-policy`'s `canonicalActionString` rather
 * than imported, for the same reason `./types.ts` mirrors `DeclarationFacets`:
 * `apps/demo` is its own bundle and does not depend on that package. The
 * safeguard against drift is a shared GOLDEN VECTOR -- the identical expected
 * string is asserted in `apps/demo/test/central_signing.test.ts` and in
 * `packages/wot-policy/test/signing.test.ts`. Change either canonicaliser and
 * both suites fail.
 *
 * A JSON array, not an object: element order is fixed by the language, whereas
 * object key order depends on who built the object, and JSON string escaping
 * keeps a value from shifting a field boundary.
 */
export function canonicalActionString(payload: SignedActionPayload): string {
  return JSON.stringify([
    SIGNED_ACTION_DOMAIN,
    payload.action,
    payload.target,
    payload.authorCommitment,
    payload.nonce,
    payload.expiresAt,
  ])
}

export function canonicalActionMessage(payload: SignedActionPayload): Uint8Array {
  return new TextEncoder().encode(canonicalActionString(payload))
}

/** 144 bits of randomness. The server refuses a second sighting of any nonce,
 *  so this only has to be unique, but it is generated rather than counted so
 *  two devices, or one device across a reinstall, cannot collide. */
export function newNonce(): string {
  return toB64u(randomBytes(18))
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

interface StoredWebCryptoKey {
  version: 1
  backend: 'webcrypto-ed25519'
  publicKeyB64u: string
  /** A non-extractable CryptoKey. IndexedDB structured-clones this; its bytes
   *  are never readable, here or anywhere else in the page. */
  privateKey: CryptoKey
}

interface StoredNobleKey {
  version: 1
  backend: 'noble-ed25519'
  publicKeyB64u: string
  /** base64url secret scalar. Same on-disk exposure as `../did.ts`'s identity
   *  record, and no better -- this path only runs where Web Crypto has no
   *  Ed25519 at all. */
  secretKeyB64u: string
}

type StoredKey = StoredWebCryptoKey | StoredNobleKey

/** Cached so a burst of withdrawals does not re-read storage per request. */
let cached: Promise<CentralSigningKey> | null = null

/** Test seam, and the local half of `clearAll`'s state wipe. Drops the
 *  in-process cache only; call `forgetSigningKey()` to erase the stored key. */
export function resetSigningKeyCache(): void {
  cached = null
}

async function webCryptoEd25519Available(): Promise<boolean> {
  try {
    const pair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    return Boolean(pair.privateKey)
  } catch {
    return false
  }
}

/** Copies into a standalone ArrayBuffer. Web Crypto's TypeScript signature
 *  wants a `BufferSource`, which since TypeScript 5.7 excludes a `Uint8Array`
 *  that might be SharedArrayBuffer-backed. A few dozen bytes. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

function fromStored(record: StoredKey): CentralSigningKey {
  if (record.backend === 'webcrypto-ed25519') {
    return {
      publicKeyB64u: record.publicKeyB64u,
      backend: 'webcrypto-ed25519',
      async sign(message: Uint8Array): Promise<Uint8Array> {
        const sig = await globalThis.crypto.subtle.sign(
          { name: 'Ed25519' },
          record.privateKey,
          bufferOf(message),
        )
        return new Uint8Array(sig)
      },
    }
  }
  const secret = fromB64u(record.secretKeyB64u)
  return {
    publicKeyB64u: record.publicKeyB64u,
    backend: 'noble-ed25519',
    async sign(message: Uint8Array): Promise<Uint8Array> {
      return ed25519.sign(message, secret)
    },
  }
}

async function generate(): Promise<StoredKey> {
  if (await webCryptoEd25519Available()) {
    const pair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    // extractable: false above applies to the PRIVATE key. Web Crypto always
    // leaves a generated public key extractable, which is what lets us register
    // it without ever being able to read the private half back out.
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey))
    return {
      version: 1,
      backend: 'webcrypto-ed25519',
      publicKeyB64u: toB64u(raw),
      privateKey: pair.privateKey,
    }
  }
  const secret = ed25519.utils.randomSecretKey()
  return {
    version: 1,
    backend: 'noble-ed25519',
    publicKeyB64u: toB64u(ed25519.getPublicKey(secret)),
    secretKeyB64u: toB64u(secret),
  }
}

function isStoredKey(value: unknown): value is StoredKey {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 1 || typeof v.publicKeyB64u !== 'string') return false
  if (v.backend === 'webcrypto-ed25519') return Boolean(v.privateKey)
  if (v.backend === 'noble-ed25519') return typeof v.secretKeyB64u === 'string'
  return false
}

/**
 * The device's central signing key, generated on first use and reused forever
 * after. Callers must have established `centralMode() === 'on'` first: this
 * function creates key material, and a device that opted out of the central
 * layer must not have any.
 */
export function getOrCreateSigningKey(): Promise<CentralSigningKey> {
  if (cached) return cached
  cached = (async () => {
    const existing = await kvGet<unknown>(SIGNING_KEY_STORAGE_KEY)
    if (isStoredKey(existing)) return fromStored(existing)
    const created = await generate()
    await kvSet(SIGNING_KEY_STORAGE_KEY, created)
    return fromStored(created)
  })()
  return cached
}

/**
 * Erases the stored key, and mints a new one on next use.
 *
 * `clearAll` deliberately does NOT call this. A clear that half-failed, or a
 * holder who clears and then publishes again, still needs the key that her
 * remaining declarations are registered under; dropping it would strand them
 * permanently. This is offered for a caller that wants the full local wipe --
 * the counterpart to `consent.ts`'s `clearAllConsents` -- and wiring it into a
 * "reset this device" flow alongside `state.ts`'s `resetAll()` is the follow-up
 * that panel work will need. DESIGNED, not wired (I7).
 */
export async function forgetSigningKey(): Promise<void> {
  resetSigningKeyCache()
  await kvDel(SIGNING_KEY_STORAGE_KEY)
}

// ---------------------------------------------------------------------------
// Signing an action
// ---------------------------------------------------------------------------

export async function signAction(
  key: CentralSigningKey,
  action: SignedActionKind,
  target: string,
  authorCommitment: string,
  now = Date.now(),
): Promise<SignedActionRequest> {
  const payload: SignedActionPayload = {
    action,
    target,
    authorCommitment,
    nonce: newNonce(),
    expiresAt: now + SIGNATURE_TTL_MS,
  }
  const signature = await key.sign(canonicalActionMessage(payload))
  return { payload, signature: toB64u(signature), publicKey: key.publicKeyB64u }
}

export function signWithdraw(
  key: CentralSigningKey,
  declarationId: string,
  authorCommitment: string,
): Promise<SignedActionRequest> {
  return signAction(key, 'withdraw', declarationId, authorCommitment)
}

export function signClear(
  key: CentralSigningKey,
  authorCommitment: string,
): Promise<SignedActionRequest> {
  return signAction(key, 'clear', CLEAR_ALL_TARGET, authorCommitment)
}
