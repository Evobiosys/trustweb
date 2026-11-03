// did:peer:2 identity for the OpenVTC pillar — self-contained, no network.
//
// A did:peer:2 encodes its own DID document inline, so resolution is a pure
// string decode (no ledger, no HTTP, no mediator). We encode exactly three
// elements, in a fixed order, so the DID string is deterministic:
//   .V<mb>  — an Ed25519 verification key (authentication / signatures)
//   .E<mb>  — an X25519 key-agreement key (ECDH encryption)
//   .S<b64> — a DIDCommMessaging service with the inbound HTTP endpoint
// where <mb> is the multibase-base58btc multicodec public key (the same
// "z6Mk…" / "z6LS…" form did:key uses) and <b64> is base64url(JSON) of the
// abbreviated service block.
//
// HONEST LABELING (I7): this is did:peer:2-SHAPED. We implement the numeric
// algorithm's element/purpose codes and the multicodec key encoding, and the
// round-trip (encode↔decode) is exact — but we do NOT claim certified
// interoperability with other did:peer implementations. See docs/TRANSPORT.md
// for the precise deviation list.
//
// SECRET STORAGE (alpha): identity secret keys are persisted as plaintext
// base64 in a JSON file (DID_IDENTITY_PATH). This is acceptable for the alpha
// two-device sim ONLY and is called out honestly in the README/docs. A
// production build must move these into an OS keystore / encrypted-at-rest
// wallet. Never log secret-key bytes.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { base58btc } from "multiformats/bases/base58";

// multicodec varint prefixes for the raw public keys (see multicodec table).
const ED25519_PUB_PREFIX = Uint8Array.from([0xed, 0x01]);
const X25519_PUB_PREFIX = Uint8Array.from([0xec, 0x01]);

// did:peer:2 purpose codes we emit.
const PURPOSE_VERIFICATION = "V"; // authentication / assertion (Ed25519)
const PURPOSE_KEY_AGREEMENT = "E"; // keyAgreement (X25519)
const PURPOSE_SERVICE = "S"; // service

const DID_PEER_2_PREFIX = "did:peer:2";

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface Identity {
  did: string;
  /** Ed25519 signing keypair (message authenticity). */
  signing: KeyPair;
  /** X25519 key-agreement keypair (ECDH encryption). */
  keyAgreement: KeyPair;
  /** Inbound DIDComm HTTP endpoint advertised in the DID's service block. */
  serviceEndpoint: string;
}

export interface ResolvedDid {
  did: string;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  serviceEndpoint: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

function encodeMultibaseKey(prefix: Uint8Array, pubkey: Uint8Array): string {
  const bytes = new Uint8Array(prefix.length + pubkey.length);
  bytes.set(prefix, 0);
  bytes.set(pubkey, prefix.length);
  return base58btc.encode(bytes); // includes the 'z' multibase prefix
}

function decodeMultibaseKey(mb: string, expectedPrefix: Uint8Array): Uint8Array {
  const bytes = base58btc.decode(mb);
  for (let i = 0; i < expectedPrefix.length; i++) {
    if (bytes[i] !== expectedPrefix[i]) {
      throw new Error("did:peer:2 key has an unexpected multicodec prefix");
    }
  }
  return bytes.slice(expectedPrefix.length);
}

const ED25519_PUBLIC_KEY_BYTES = 32;

/**
 * An Ed25519 public key in exactly the did:peer:2 `V` element encoding: multicodec `ed25519-pub` (0xed 0x01) prefix,
 * multibase base58btc (`z6Mk…`). Used by did_key_records.ts / relay_send_auth.ts as a device key id (`kid`).
 */
export function encodeEd25519Multibase(pub: Uint8Array): string {
  return encodeMultibaseKey(ED25519_PUB_PREFIX, pub);
}

/** Inverse of encodeEd25519Multibase. Throws unless `mb` is a base58btc multicodec Ed25519 key of exactly 32 bytes. */
export function decodeEd25519Multibase(mb: string): Uint8Array {
  const key = decodeMultibaseKey(mb, ED25519_PUB_PREFIX);
  if (key.length !== ED25519_PUBLIC_KEY_BYTES) throw new Error("Ed25519 multibase key must be 32 bytes");
  return key;
}

/** Abbreviated did:peer:2 service block; `t:"dm"` expands to DIDCommMessaging. */
interface AbbreviatedService {
  t: "dm";
  s: string; // serviceEndpoint URI
  a: string[]; // accept
}

function encodeServiceElement(endpoint: string): string {
  const svc: AbbreviatedService = { t: "dm", s: endpoint, a: ["didcomm/v2"] };
  return PURPOSE_SERVICE + b64urlEncode(Buffer.from(JSON.stringify(svc), "utf8"));
}

function buildDidPeer2(signingPub: Uint8Array, keyAgreementPub: Uint8Array, endpoint: string): string {
  const vElement = PURPOSE_VERIFICATION + encodeEd25519Multibase(signingPub);
  const eElement = PURPOSE_KEY_AGREEMENT + encodeMultibaseKey(X25519_PUB_PREFIX, keyAgreementPub);
  const sElement = encodeServiceElement(endpoint);
  return `${DID_PEER_2_PREFIX}.${vElement}.${eElement}.${sElement}`;
}

/**
 * Mints a fresh identity for `serviceEndpoint` (the URL a peer POSTs encrypted
 * messages to — this daemon's own `http://host:port/didcomm`).
 */
export function createIdentity(serviceEndpoint: string): Identity {
  const signingSecret = ed25519.utils.randomSecretKey();
  const signingPublic = ed25519.getPublicKey(signingSecret);
  const kaSecret = x25519.utils.randomSecretKey();
  const kaPublic = x25519.getPublicKey(kaSecret);
  return {
    did: buildDidPeer2(signingPublic, kaPublic, serviceEndpoint),
    signing: { secretKey: signingSecret, publicKey: signingPublic },
    keyAgreement: { secretKey: kaSecret, publicKey: kaPublic },
    serviceEndpoint,
  };
}

/**
 * Local resolver: decodes the inline keys + service from a did:peer:2 string.
 * No network. Throws on any non-did:peer:2 input or malformed element.
 */
export function resolveDidPeer(did: string): ResolvedDid {
  if (!did.startsWith(DID_PEER_2_PREFIX + ".")) {
    throw new Error(`not a did:peer:2 DID: ${did.slice(0, 32)}`);
  }
  const elements = did.slice(DID_PEER_2_PREFIX.length + 1).split(".");
  let signingPublicKey: Uint8Array | undefined;
  let keyAgreementPublicKey: Uint8Array | undefined;
  let serviceEndpoint: string | undefined;

  for (const el of elements) {
    const code = el[0];
    const value = el.slice(1);
    if (code === PURPOSE_VERIFICATION) {
      signingPublicKey = decodeEd25519Multibase(value);
    } else if (code === PURPOSE_KEY_AGREEMENT) {
      keyAgreementPublicKey = decodeMultibaseKey(value, X25519_PUB_PREFIX);
    } else if (code === PURPOSE_SERVICE) {
      const svc = JSON.parse(Buffer.from(b64urlDecode(value)).toString("utf8")) as Partial<AbbreviatedService>;
      if (typeof svc.s !== "string") throw new Error("did:peer:2 service block has no endpoint");
      serviceEndpoint = svc.s;
    }
    // Unknown purpose codes are ignored (forward-compat), matching resolvers.
  }

  if (!signingPublicKey) throw new Error("did:peer:2 missing a verification (V) key");
  if (!keyAgreementPublicKey) throw new Error("did:peer:2 missing a key-agreement (E) key");
  if (!serviceEndpoint) throw new Error("did:peer:2 missing a service (S) endpoint");
  return { did, signingPublicKey, keyAgreementPublicKey, serviceEndpoint };
}

/** On-disk shape. Secret keys as base64 (alpha plaintext — see file header). */
interface IdentityFileV1 {
  version: 1;
  did: string;
  serviceEndpoint: string;
  signingSecretKey: string; // base64
  keyAgreementSecretKey: string; // base64
}

/**
 * Deterministic serialization: the JSON key order is fixed by the object
 * literal below, so the same identity serializes byte-identically every time.
 */
export function serializeIdentity(identity: Identity): string {
  const file: IdentityFileV1 = {
    version: 1,
    did: identity.did,
    serviceEndpoint: identity.serviceEndpoint,
    signingSecretKey: Buffer.from(identity.signing.secretKey).toString("base64"),
    keyAgreementSecretKey: Buffer.from(identity.keyAgreement.secretKey).toString("base64"),
  };
  return JSON.stringify(file, null, 2);
}

/** Restores an Identity from disk JSON, re-deriving public keys from the secrets. */
export function deserializeIdentity(json: string): Identity {
  const file = JSON.parse(json) as IdentityFileV1;
  if (file.version !== 1) throw new Error(`unsupported identity file version: ${String(file.version)}`);
  const signingSecret = new Uint8Array(Buffer.from(file.signingSecretKey, "base64"));
  const kaSecret = new Uint8Array(Buffer.from(file.keyAgreementSecretKey, "base64"));
  return {
    did: file.did,
    serviceEndpoint: file.serviceEndpoint,
    signing: { secretKey: signingSecret, publicKey: ed25519.getPublicKey(signingSecret) },
    keyAgreement: { secretKey: kaSecret, publicKey: x25519.getPublicKey(kaSecret) },
  };
}

export interface CardPayload {
  display: string;
  did: string;
  endpoint: string;
  /**
   * Relay-node DIDs (core-transport-plan.md Task 8) this peer is reachable
   * through — resolved locally via `resolveDidPeer`, exactly like any other
   * DID this package handles. No new endpoint format: a relay is just
   * another did:peer:2 whose service block a LadderChannel can resolve.
   * Omitted entirely (not merely undefined) when the caller supplies none,
   * so the QR/compact card JSON stays byte-minimal for the mock/matrix path.
   */
  relays?: string[];
  /**
   * Optional STUN/TURN URLs for the deferred WebRTC rung (T4/T5, see
   * core-transport-plan.md §0 SCOPE REVISION). Not exercised by any
   * mediator-only code path today; carried here so a future rung-(a) upgrade
   * is additive to the card shape rather than another breaking change.
   */
  ice_servers?: string[];
}

/**
 * The DID card payload for the meet-card (Task 5's /api/card). Exposed as a
 * function so this transport package stays decoupled from the daemon's HTTP
 * surface; wiring into /api/card happens at integration.
 *
 * `opts.relays`/`opts.ice_servers` are spread in only when explicitly
 * supplied (Task 8) — an absent option leaves the key off the returned
 * object entirely (not `{relays: undefined}`), which is what keeps the
 * existing mock-transport card (no opts passed) byte-identical to before
 * this change.
 */
export function getCardPayload(
  identity: Identity,
  displayName: string,
  opts?: { relays?: string[]; ice_servers?: string[] }
): CardPayload {
  return {
    display: displayName,
    did: identity.did,
    endpoint: identity.serviceEndpoint,
    ...(opts?.relays !== undefined ? { relays: opts.relays } : {}),
    ...(opts?.ice_servers !== undefined ? { ice_servers: opts.ice_servers } : {}),
  };
}
