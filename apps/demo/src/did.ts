/**
 * Browser-native did:peer:2 identity for the demo app.
 *
 * `packages/transport/src/did_identity.ts` is the server-side reference
 * implementation and the thing whose `resolveDidPeer` a wire minted here must
 * satisfy byte-for-byte -- that is the whole contract this file exists to
 * meet (see `test/did_interop.test.ts`, the gate for the relay feature). It
 * cannot be imported directly: it uses Node's `Buffer` in six places, which
 * is not guaranteed inside a browser bundle. This is a REIMPLEMENTATION of
 * its did:peer:2 algorithm (same multicodec prefixes, same V/E/S element
 * order, same abbreviated service block), ported to run on Web APIs only.
 *
 * The same reuse decision was already made once, independently, in
 * `packages/browser-agent/src/identity.ts` -- see that file's header for the
 * identical rationale. This file mirrors it rather than importing it: this
 * package's contract with `packages/browser-agent` is "no coupling", per the
 * handover (`apps/demo/` is its own bundle and must not pull in a sibling
 * app's package).
 *
 * base64url comes from `./crypto.ts` (`toB64u`/`fromB64u`), which is already
 * Buffer-free -- no polyfill added here. base58btc (multibase `z` prefix) for
 * the key elements comes from `multiformats/bases/base58`, the same package
 * `did_identity.ts` uses; its `baseX` implementation is pure JS over
 * `Uint8Array` with no Node builtins, so it is browser-safe as-is.
 *
 * HONEST LABELING (I7, mirrors did_identity.ts): did:peer:2-SHAPED. We
 * implement the numeric algorithm's element/purpose codes and the multicodec
 * key encoding, and round-trip (encode<->decode) is exact, but this does NOT
 * claim certified interoperability with other did:peer implementations
 * outside this repo.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { base58btc } from 'multiformats/bases/base58'
import { fromB64u, toB64u } from './crypto'

// multicodec varint prefixes for the raw public keys (multicodec table).
// Must match did_identity.ts exactly, or a demo-minted DID will not resolve
// on the server.
const ED25519_PUB_PREFIX = Uint8Array.from([0xed, 0x01])
const X25519_PUB_PREFIX = Uint8Array.from([0xec, 0x01])

// did:peer:2 purpose codes, in the fixed order this module always emits.
const PURPOSE_VERIFICATION = 'V' // authentication / assertion (Ed25519)
const PURPOSE_KEY_AGREEMENT = 'E' // keyAgreement (X25519)
const PURPOSE_SERVICE = 'S' // service

const DID_PEER_2_PREFIX = 'did:peer:2'

export interface KeyPair {
  secretKey: Uint8Array
  publicKey: Uint8Array
}

export interface Identity {
  did: string
  /** Ed25519 signing keypair (message authenticity, relay drain auth). */
  signing: KeyPair
  /** X25519 key-agreement keypair. Carried on the DID for shape-compatibility
   *  with did_identity.ts; the demo's relay channel does not use it (the pair
   *  key comes from the QR ceremony's `derivePairKey`, not ECDH). */
  keyAgreement: KeyPair
  /** Inbound endpoint advertised in the DID's service block. The demo has no
   *  HTTP endpoint of its own -- see relay.ts -- so this is informational. */
  serviceEndpoint: string
}

function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function utf8FromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function encodeMultibaseKey(prefix: Uint8Array, pubkey: Uint8Array): string {
  const bytes = new Uint8Array(prefix.length + pubkey.length)
  bytes.set(prefix, 0)
  bytes.set(pubkey, prefix.length)
  return base58btc.encode(bytes) // includes the 'z' multibase prefix
}

/** Abbreviated did:peer:2 service block; `t:"dm"` expands to DIDCommMessaging. */
interface AbbreviatedService {
  t: 'dm'
  s: string // serviceEndpoint URI
  a: string[] // accept
}

function encodeServiceElement(endpoint: string): string {
  const svc: AbbreviatedService = { t: 'dm', s: endpoint, a: ['didcomm/v2'] }
  return PURPOSE_SERVICE + toB64u(utf8ToBytes(JSON.stringify(svc)))
}

function buildDidPeer2(signingPub: Uint8Array, keyAgreementPub: Uint8Array, endpoint: string): string {
  const vElement = PURPOSE_VERIFICATION + encodeMultibaseKey(ED25519_PUB_PREFIX, signingPub)
  const eElement = PURPOSE_KEY_AGREEMENT + encodeMultibaseKey(X25519_PUB_PREFIX, keyAgreementPub)
  const sElement = encodeServiceElement(endpoint)
  return `${DID_PEER_2_PREFIX}.${vElement}.${eElement}.${sElement}`
}

/**
 * Mints a fresh identity for `serviceEndpoint`. The endpoint is carried in
 * the DID purely so the shape matches did_identity.ts's; the relay channel
 * (relay.ts) routes on the DID itself, never on this field.
 */
export function createIdentity(serviceEndpoint: string): Identity {
  const signingSecret = ed25519.utils.randomSecretKey()
  const signingPublic = ed25519.getPublicKey(signingSecret)
  const kaSecret = x25519.utils.randomSecretKey()
  const kaPublic = x25519.getPublicKey(kaSecret)
  return {
    did: buildDidPeer2(signingPublic, kaPublic, serviceEndpoint),
    signing: { secretKey: signingSecret, publicKey: signingPublic },
    keyAgreement: { secretKey: kaSecret, publicKey: kaPublic },
    serviceEndpoint,
  }
}

/**
 * Ed25519-signs a base64url-encoded relay drain challenge nonce with this
 * identity's signing key, returning the signature as base64url. This is the
 * exact operation `relay_server.ts`'s `handleAuth` verifies via
 * `resolveDidPeer(claimedDid).signingPublicKey` -- see
 * `test/did_interop.test.ts` for the direct proof against the real server
 * verifier.
 */
export function signChallenge(identity: Identity, nonceB64u: string): string {
  const nonceBytes = fromB64u(nonceB64u)
  const sig = ed25519.sign(nonceBytes, identity.signing.secretKey)
  return toB64u(sig)
}

/** Ed25519-signs arbitrary bytes with this identity's signing key; base64url. */
export function signBytes(identity: Identity, bytes: Uint8Array): string {
  return toB64u(ed25519.sign(bytes, identity.signing.secretKey))
}

/** True when `sigB64u` is a valid signature over `bytes` by the signing key inside `did`; false for any malformed input. */
export function verifyDidSignature(did: string, bytes: Uint8Array, sigB64u: string): boolean {
  try {
    return ed25519.verify(fromB64u(sigB64u), bytes, resolveDidPeer(did).signingPublicKey)
  } catch {
    return false
  }
}

/** On-disk shape for `db.ts`. Secret keys as base64url (alpha plaintext --
 *  same tradeoff did_identity.ts documents for its own on-disk format; a
 *  production build must move this behind a non-exportable key or an
 *  OS-backed credential store). Exported so `state.ts` can type the field
 *  it persists this into (`DeviceState.relayIdentity`) without duplicating
 *  the shape. */
export interface SerializedIdentityV1 {
  version: 1
  did: string
  serviceEndpoint: string
  signingSecretKey: string // base64url
  keyAgreementSecretKey: string // base64url
}

/**
 * Deterministic serialization for storage via `db.ts`'s `kvSet`: the object
 * key order below is fixed, so the same identity serializes identically
 * every time.
 */
export function serializeIdentity(identity: Identity): SerializedIdentityV1 {
  return {
    version: 1,
    did: identity.did,
    serviceEndpoint: identity.serviceEndpoint,
    signingSecretKey: toB64u(identity.signing.secretKey),
    keyAgreementSecretKey: toB64u(identity.keyAgreement.secretKey),
  }
}

/** Restores an Identity from a `db.ts`-stored record, re-deriving public keys from the secrets. */
export function deserializeIdentity(record: unknown): Identity {
  const file = record as SerializedIdentityV1
  if (file?.version !== 1) throw new Error(`unsupported identity record version: ${String(file?.version)}`)
  const signingSecret = fromB64u(file.signingSecretKey)
  const kaSecret = fromB64u(file.keyAgreementSecretKey)
  return {
    did: file.did,
    serviceEndpoint: file.serviceEndpoint,
    signing: { secretKey: signingSecret, publicKey: ed25519.getPublicKey(signingSecret) },
    keyAgreement: { secretKey: kaSecret, publicKey: x25519.getPublicKey(kaSecret) },
  }
}

/**
 * Local resolver: decodes the inline keys + service from a did:peer:2
 * string. Not needed by relay.ts (the pair key comes from the QR ceremony,
 * not from resolving a peer's key-agreement key), but kept here -- and
 * unit-tested for interop -- because it is the natural counterpart to
 * `createIdentity` and future callers (e.g. verifying a peer's own signed
 * message) will want it. Mirrors did_identity.ts's `resolveDidPeer`
 * byte-for-byte; see the interop test for direct proof.
 */
export interface ResolvedDid {
  did: string
  signingPublicKey: Uint8Array
  keyAgreementPublicKey: Uint8Array
  serviceEndpoint: string
}

function decodeMultibaseKey(mb: string, expectedPrefix: Uint8Array): Uint8Array {
  const bytes = base58btc.decode(mb)
  for (let i = 0; i < expectedPrefix.length; i++) {
    if (bytes[i] !== expectedPrefix[i]) {
      throw new Error('did:peer:2 key has an unexpected multicodec prefix')
    }
  }
  return bytes.slice(expectedPrefix.length)
}

export function resolveDidPeer(did: string): ResolvedDid {
  if (!did.startsWith(DID_PEER_2_PREFIX + '.')) {
    throw new Error(`not a did:peer:2 DID: ${did.slice(0, 32)}`)
  }
  const elements = did.slice(DID_PEER_2_PREFIX.length + 1).split('.')
  let signingPublicKey: Uint8Array | undefined
  let keyAgreementPublicKey: Uint8Array | undefined
  let serviceEndpoint: string | undefined

  for (const el of elements) {
    const code = el[0]
    const value = el.slice(1)
    if (code === PURPOSE_VERIFICATION) {
      signingPublicKey = decodeMultibaseKey(value, ED25519_PUB_PREFIX)
    } else if (code === PURPOSE_KEY_AGREEMENT) {
      keyAgreementPublicKey = decodeMultibaseKey(value, X25519_PUB_PREFIX)
    } else if (code === PURPOSE_SERVICE) {
      const svc = JSON.parse(utf8FromBytes(fromB64u(value))) as Partial<AbbreviatedService>
      if (typeof svc.s !== 'string') throw new Error('did:peer:2 service block has no endpoint')
      serviceEndpoint = svc.s
    }
    // Unknown purpose codes are ignored (forward-compat), matching resolvers.
  }

  if (!signingPublicKey) throw new Error('did:peer:2 missing a verification (V) key')
  if (!keyAgreementPublicKey) throw new Error('did:peer:2 missing a key-agreement (E) key')
  if (!serviceEndpoint) throw new Error('did:peer:2 missing a service (S) endpoint')
  return { did, signingPublicKey, keyAgreementPublicKey, serviceEndpoint }
}

/**
 * X25519 ECDH shared secret between `identity`'s own key-agreement keypair
 * and `theirDid`'s resolved key-agreement public key -- the REAL key
 * agreement the one-scan connect-link ceremony uses instead of
 * crypto.ts's `derivePairKey` (two plaintext nonces).
 *
 * Why this matters (see connect_link.ts's module header for the full
 * writeup): a nonce that ever crosses the relay -- unavoidable in a
 * one-scan ceremony, where one side's half of the pairing material must
 * travel over the network because there is no second scan to carry it back
 * -- is a nonce the relay has seen, so `derivePairKey(nonceA, nonceB)`
 * would let the relay compute the same pair key it is supposed to be
 * excluded from. X25519(myPriv, theirPub) === X25519(theirPriv, myPub): a
 * did:peer:2's `E` element carries a PUBLIC key, safe to put in a URL or
 * send in the clear, and the relay learning both parties' DIDs (which it
 * must, to route -- see relay.ts's module header) never lets it compute
 * this shared secret, because that needs a PRIVATE key that never leaves
 * either device.
 *
 * Raw bytes only, deliberately: turning this into an AES-GCM `CryptoKey`
 * is a WebCrypto (HKDF) step, kept in crypto.ts (see its
 * `deriveEcdhPairKey`) rather than here, the same "key material" /
 * "WebCrypto operations" split this file and crypto.ts already draw
 * everywhere else.
 */
export function ecdhSharedSecret(identity: Identity, theirDid: string): Uint8Array {
  const resolved = resolveDidPeer(theirDid)
  return x25519.getSharedSecret(identity.keyAgreement.secretKey, resolved.keyAgreementPublicKey)
}
