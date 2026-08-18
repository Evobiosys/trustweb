// Sealed-box style E2EE for the rebiosys relay: the browser encrypts a query
// payload to the laptop's long-lived public key; the relay only ever stores
// the resulting envelope (ciphertext + a fresh ephemeral public key); only
// the laptop's private key can open it. WebCrypto only (globalThis.crypto.
// subtle), no runtime deps, works identically in Node >= 20 and browsers.
//
// Scheme: ECDH-ES (P-256) + HKDF-SHA-256 -> AES-256-GCM, one ephemeral P-256
// keypair per message (forward secrecy per message; the relay never sees a
// long-lived private key). Mirrors the JOSE "ECDH-ES" content-encryption
// idea without pulling in a JOSE library.

const CURVE = "P-256" as const;
const HKDF_INFO = "rebiosys-relay-e2ee-v1";
const IV_BYTES = 12;

export const ALG = "ECDH-ES+A256GCM" as const;

export interface SealEnvelope {
  v: 1;
  alg: typeof ALG;
  /** Ephemeral sender public key for this message only (JWK, P-256). */
  epk: JsonWebKey;
  /** AES-GCM IV, base64. */
  iv: string;
  /** AES-GCM ciphertext (includes the auth tag), base64. */
  ct: string;
}

export interface KeyPairExport {
  publicJwk: JsonWebKey;
  /** PKCS8-encoded private key, base64. */
  privatePkcs8Base64: string;
}

function subtle(): SubtleCrypto {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("WebCrypto (globalThis.crypto.subtle) is not available in this runtime");
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c) throw new Error("WebCrypto (globalThis.crypto) is not available in this runtime");
  return c.getRandomValues(new Uint8Array(n));
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// TS's DOM lib types WebCrypto inputs as BufferSource (ArrayBufferView tied
// to a plain ArrayBuffer); Node's Buffer/Uint8Array are typed against the
// broader ArrayBufferLike (which also covers SharedArrayBuffer), so the two
// don't unify structurally even though every value here is always backed by
// a real ArrayBuffer at runtime. Narrow explicitly at the WebCrypto call
// boundary rather than fighting the lib types.
function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function isCryptoKey(value: CryptoKey | string | Uint8Array): value is CryptoKey {
  return typeof value === "object" && value !== null && value instanceof CryptoKey;
}

/** Generates a long-lived P-256 keypair for the laptop side. */
export async function generateKeyPair(): Promise<KeyPairExport> {
  const pair = await subtle().generateKey({ name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
  const publicJwk = (await subtle().exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  return { publicJwk, privatePkcs8Base64: toBase64(pkcs8) };
}

/** Imports a PKCS8-encoded (base64 or raw bytes) private key as a CryptoKey. */
export async function importPrivateKey(pkcs8: string | Uint8Array): Promise<CryptoKey> {
  const bytes = typeof pkcs8 === "string" ? fromBase64(pkcs8) : pkcs8;
  return subtle().importKey("pkcs8", bufferSource(bytes), { name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
}

async function deriveAesKey(
  ecdhPrivateKey: CryptoKey,
  otherPublicKey: CryptoKey,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const sharedBits = await subtle().deriveBits({ name: "ECDH", public: otherPublicKey } as EcdhKeyDeriveParams, ecdhPrivateKey, 256);
  const hkdfKey = await subtle().importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bufferSource(new Uint8Array(0)),
      info: bufferSource(new TextEncoder().encode(HKDF_INFO)),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** Encrypts `plaintext` to the holder of `publicJwk` (the laptop's public key). */
export async function seal(publicJwk: JsonWebKey, plaintext: Uint8Array): Promise<SealEnvelope> {
  const recipientKey = await subtle().importKey("jwk", publicJwk, { name: "ECDH", namedCurve: CURVE }, true, []);
  const ephemeral = await subtle().generateKey({ name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
  const aesKey = await deriveAesKey(ephemeral.privateKey, recipientKey, "encrypt");
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, aesKey, bufferSource(plaintext));
  const epk = (await subtle().exportKey("jwk", ephemeral.publicKey)) as JsonWebKey;
  return { v: 1, alg: ALG, epk, iv: toBase64(iv), ct: toBase64(ct) };
}

/** Decrypts an envelope produced by `seal` using the recipient's private key. */
export async function unseal(
  privateKey: CryptoKey | string | Uint8Array,
  envelope: SealEnvelope,
): Promise<Uint8Array> {
  if (envelope.v !== 1 || envelope.alg !== ALG) {
    throw new Error(`unsupported envelope: v=${envelope.v} alg=${envelope.alg}`);
  }
  const key = isCryptoKey(privateKey) ? privateKey : await importPrivateKey(privateKey);
  const senderKey = await subtle().importKey("jwk", envelope.epk, { name: "ECDH", namedCurve: CURVE }, true, []);
  const aesKey = await deriveAesKey(key, senderKey, "decrypt");
  const plaintext = await subtle().decrypt(
    { name: "AES-GCM", iv: bufferSource(fromBase64(envelope.iv)) },
    aesKey,
    bufferSource(fromBase64(envelope.ct)),
  );
  return new Uint8Array(plaintext);
}
