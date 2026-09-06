// Signed withdraw and clear (decision B-20, option A, 2026-09-06).
//
// ---------------------------------------------------------------------------
// WHY THIS LIVES IN wot-policy AND NOT IN central-index
// ---------------------------------------------------------------------------
// The same discipline the floor already holds: the server may never be more
// permissive than the device. The device builds the canonical message here and
// the server verifies it here, from one implementation, so a canonicalisation
// drift cannot open a gap between what a holder signed and what an operator
// accepts. The stateful halves -- the single-use nonce registry and the
// per-key rate limiter -- are deliberately NOT here: they are server state,
// they must never enter a browser bundle, and they live in
// packages/central-index alongside the store.
//
// ---------------------------------------------------------------------------
// ALGORITHM: Ed25519
// ---------------------------------------------------------------------------
// Raw 32-byte public keys, raw 64-byte signatures, verified through Web Crypto
// (`crypto.subtle`, algorithm `Ed25519`), so this module keeps its zero
// runtime dependencies and stays embeddable in a browser bundle or a bare
// `node:http` server alike. Ed25519 is also what this repo already signs with:
// `apps/demo/src/did.ts`'s `signChallenge` and `packages/transport`'s
// `resolveDidPeer` use @noble/curves' Ed25519 over the same raw encodings.
// Verified interoperable in both directions (a @noble/curves signature
// verifies here, a Web Crypto signature verifies there) -- see
// `test/signing.test.ts`. A holder device may therefore sign with either.
//
// ---------------------------------------------------------------------------
// WHAT A SIGNATURE DOES AND DOES NOT BUY
// ---------------------------------------------------------------------------
// It proves the caller holds the private key registered with a declaration at
// publish time. It does NOT identify the holder, does not link two holders,
// and is never stored beyond the request. An `authorCommitment` remains a
// deterministic hash and therefore not a secret; after this scheme lands,
// knowing one no longer lets anybody withdraw or clear anything.

/** Domain separation. Bump the suffix, never the shape, if the message changes. */
export const SIGNED_ACTION_DOMAIN = 'ew-central-signed-action-v1'

/**
 * Upper bound on how far into the future a signature may claim to be valid.
 * Short on purpose: a signed action is a one-shot capability, not a bearer
 * token. Without this bound a holder (or anyone who captured one request)
 * could mint `expiresAt: 9e15` and hold a permanent withdraw capability.
 */
export const SIGNATURE_MAX_TTL_MS = 120_000

/** Clock skew tolerated between the signing device and the server. */
export const SIGNATURE_CLOCK_SKEW_MS = 30_000

/** The literal `target` a clear-everything action carries. */
export const CLEAR_ALL_TARGET = 'all'

export type SignedActionKind = 'withdraw' | 'clear'

/**
 * Exactly what a holder signs. Every field is load-bearing:
 *
 * - `action`    -- a withdraw signature must not be replayable as a clear.
 * - `target`    -- the declaration id, or `CLEAR_ALL_TARGET` for a clear.
 * - `authorCommitment` -- binds the action to one holder's records, so a
 *                 valid signature can never reach across holders.
 * - `nonce`     -- single-use; the server refuses a second sighting.
 * - `expiresAt` -- epoch ms; bounded above by SIGNATURE_MAX_TTL_MS.
 */
export interface SignedActionPayload {
  action: SignedActionKind
  target: string
  authorCommitment: string
  nonce: string
  expiresAt: number
}

/** The wire shape of a signed withdraw or clear request body. */
export interface SignedActionRequest {
  payload: SignedActionPayload
  /** base64url, unpadded: the raw 64-byte Ed25519 signature. */
  signature: string
  /** base64url, unpadded: the raw 32-byte Ed25519 public key registered at publish time. */
  publicKey: string
}

/**
 * Why a signed action was refused. Every one of these is a 403 with the reason
 * named out loud: an unsigned or bad request must fail loudly rather than
 * silently doing nothing, so a holder whose clear did not happen finds out.
 * (I3's indistinguishable-no covers `/query` only -- it protects an ASKER from
 * learning whether a holder matched. Withdraw and clear are the holder's own
 * requests about her own records; hiding the outcome from her would protect
 * nobody and would hide a broken clear.)
 */
export type SignedActionRejection =
  | 'signature-required'
  | 'malformed-signed-action'
  | 'action-mismatch'
  | 'expired'
  | 'expiry-too-far'
  | 'signature-invalid'

export type SignedActionVerdict =
  | { kind: 'ok'; request: SignedActionRequest }
  | { kind: 'rejected'; reason: SignedActionRejection }

// ---------------------------------------------------------------------------
// base64url, unpadded (RFC 4648 §5)
// ---------------------------------------------------------------------------
// Hand-rolled rather than btoa/Buffer for the same reason
// apps/demo/src/crypto.ts hand-rolls it: identical behaviour in a browser and
// in Node, and no dependency of any kind.

const B64U_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const B64U_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {}
  for (let i = 0; i < B64U_ALPHABET.length; i++) table[B64U_ALPHABET[i]] = i
  return table
})()

export function toB64u(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  const len = bytes.length
  for (; i + 3 <= len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      B64U_ALPHABET[(n >> 18) & 63] +
      B64U_ALPHABET[(n >> 12) & 63] +
      B64U_ALPHABET[(n >> 6) & 63] +
      B64U_ALPHABET[n & 63]
  }
  const rem = len - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64U_ALPHABET[(n >> 18) & 63] + B64U_ALPHABET[(n >> 12) & 63]
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64U_ALPHABET[(n >> 18) & 63] + B64U_ALPHABET[(n >> 12) & 63] + B64U_ALPHABET[(n >> 6) & 63]
  }
  return out
}

/**
 * Inverse of {@link toB64u}. Returns null rather than throwing: every caller
 * here decodes attacker-supplied wire data and wants a rejection, not an
 * exception that would land in the server's generic 500 path.
 *
 * STRICTLY CANONICAL. A 32-byte key occupies 43 base64url characters = 258
 * bits, so two bits are left over; a lenient decoder would accept four
 * different strings for the same key. That is not cosmetic here: the rate
 * limiter is keyed on the public-key STRING, so four spellings would be four
 * separate budgets, and `holderPubKey === publicKey` in the store would fail
 * for a variant spelling, silently erasing nothing while answering 204. So any
 * leftover bit that is not zero, and any length that no encoding can produce,
 * is a rejection.
 */
export function fromB64u(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null // no byte string encodes to this length
  const out = new Uint8Array(Math.floor((s.length * 6) / 8))
  let bitBuffer = 0
  let bitCount = 0
  let outIdx = 0
  for (let i = 0; i < s.length; i++) {
    const val = B64U_LOOKUP[s[i]]
    if (val === undefined) return null
    bitBuffer = (bitBuffer << 6) | val
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      out[outIdx++] = (bitBuffer >> bitCount) & 0xff
    }
  }
  if (bitCount > 0 && (bitBuffer & ((1 << bitCount) - 1)) !== 0) return null
  return out
}

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

/**
 * The exact string a holder signs, and the exact string the server verifies.
 *
 * A JSON ARRAY, not an object: array element order is fixed by the language,
 * whereas object key order is a property of whoever built the object, and two
 * implementations that disagree about key order would produce two different
 * messages for the same action. JSON string escaping also makes the encoding
 * injection-proof -- a declaration id containing a delimiter cannot shift a
 * field boundary the way a `k=v\n` encoding would let it.
 *
 * `apps/demo/src/central/signing.ts` mirrors this function byte for byte
 * (apps/demo does not depend on this package -- see central/types.ts on why).
 * Both packages assert the SAME golden vector in their own test file, so a
 * change to either implementation breaks both suites loudly.
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

/** UTF-8 bytes of {@link canonicalActionString}: what is actually signed. */
export function canonicalActionMessage(payload: SignedActionPayload): Uint8Array {
  return new TextEncoder().encode(canonicalActionString(payload))
}

// ---------------------------------------------------------------------------
// Validation and verification
// ---------------------------------------------------------------------------

function isSignedActionPayload(value: unknown): value is SignedActionPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.action !== 'withdraw' && v.action !== 'clear') return false
  if (typeof v.target !== 'string' || v.target.length === 0) return false
  if (typeof v.authorCommitment !== 'string' || v.authorCommitment.length === 0) return false
  if (typeof v.nonce !== 'string' || v.nonce.length < 16) return false
  if (typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt)) return false
  return true
}

/** Shape check only. Says nothing about whether the signature is good. */
export function validateSignedActionRequest(value: unknown): SignedActionRequest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isSignedActionPayload(v.payload)) return null
  if (typeof v.signature !== 'string' || typeof v.publicKey !== 'string') return null
  return { payload: v.payload, signature: v.signature, publicKey: v.publicKey }
}

/**
 * Copies `bytes` into a standalone ArrayBuffer.
 *
 * Web Crypto's TypeScript signature takes `BufferSource`, which since
 * TypeScript 5.7 means an ArrayBuffer-backed view specifically, while a plain
 * `Uint8Array` is typed as possibly SharedArrayBuffer-backed. Passing an
 * ArrayBuffer sidesteps that mismatch without pinning this package to one
 * TypeScript lib generation. The copy is 32 to a few hundred bytes.
 */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

/** Raw Ed25519 verify. Any failure -- bad encoding, wrong key length, a runtime
 *  without Ed25519 -- resolves false rather than throwing. */
export async function verifyEd25519(
  publicKeyB64u: string,
  signatureB64u: string,
  message: Uint8Array,
): Promise<boolean> {
  const publicKey = fromB64u(publicKeyB64u)
  const signature = fromB64u(signatureB64u)
  if (!publicKey || publicKey.length !== 32) return false
  if (!signature || signature.length !== 64) return false
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      bufferOf(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      bufferOf(signature),
      bufferOf(message),
    )
  } catch {
    return false
  }
}

export interface VerifySignedActionInput {
  /** The parsed request body, unvalidated. */
  body: unknown
  /** Which action the endpoint being called represents. */
  expectedAction: SignedActionKind
  /** The declaration id for a withdraw, or CLEAR_ALL_TARGET for a clear. */
  expectedTarget: string
  now?: number
  maxTtlMs?: number
  clockSkewMs?: number
}

/**
 * The whole crypto half of the check, in the order that fails cheapest first.
 * The stateful half -- has this nonce been seen before, is this key over its
 * rate limit -- is the caller's, because it is server state.
 *
 * Deliberately checks `action` and `target` against what the ENDPOINT is,
 * never against what the body claims: otherwise a signature over
 * `{action:'withdraw', target:'x'}` would be accepted by `POST /clear` merely
 * because both fields are internally consistent.
 */
export async function verifySignedAction(input: VerifySignedActionInput): Promise<SignedActionVerdict> {
  const request = validateSignedActionRequest(input.body)
  if (!request) {
    // Tell an old, unsigned client exactly what is missing rather than 400ing
    // it as malformed JSON: this is the migration path, and it must be legible.
    const looksEmpty = !input.body || typeof input.body !== 'object' ||
      (input.body as Record<string, unknown>).payload === undefined
    return { kind: 'rejected', reason: looksEmpty ? 'signature-required' : 'malformed-signed-action' }
  }

  const { payload } = request
  if (payload.action !== input.expectedAction || payload.target !== input.expectedTarget) {
    return { kind: 'rejected', reason: 'action-mismatch' }
  }

  const now = input.now ?? Date.now()
  const maxTtlMs = input.maxTtlMs ?? SIGNATURE_MAX_TTL_MS
  const skew = input.clockSkewMs ?? SIGNATURE_CLOCK_SKEW_MS
  // The skew allowance applies to BOTH ends of the window, not just the far
  // one. A device whose clock lags the server by more than the client's own TTL
  // would otherwise sign an expiresAt already in the server's past and be
  // refused on every single withdraw, forever -- and withdraw is the path the
  // demo debrief calls a hard requirement. Tolerating `skew` of lag costs at
  // most `skew` extra seconds of validity on an already-short signature.
  if (payload.expiresAt <= now - skew) return { kind: 'rejected', reason: 'expired' }
  if (payload.expiresAt - now > maxTtlMs + skew) return { kind: 'rejected', reason: 'expiry-too-far' }

  const ok = await verifyEd25519(request.publicKey, request.signature, canonicalActionMessage(payload))
  if (!ok) return { kind: 'rejected', reason: 'signature-invalid' }

  return { kind: 'ok', request }
}
