/**
 * End-to-end encrypted backup of the whole phone record.
 *
 * Everything here runs on the phone (WebCrypto). The server only ever sees:
 *   - a blob id (derived from the key, reveals nothing about it),
 *   - the write token, as received in a header (the server stores only its SHA-256),
 *   - opaque ciphertext.
 *
 * Key model
 *   A backup key is 32 secret bytes, shown to the person as a recovery key text:
 *     TW1R-xxxxx-xxxxx-...   random key, made on this phone
 *     TW1P-xxxxx-xxxxx-...   derived from a passphrase the person chose
 *   (Crockford base32, 55 characters after the prefix: 52 key characters + 3 check characters.)
 *   The text is all that restore needs. A passphrase-derived key can also be re-derived
 *   from the passphrase alone (keyFromPassphrase is deterministic).
 *
 * Derivation (HKDF-SHA256, empty salt, distinct info labels):
 *   enc key    <- "trustweb-backup/v1/enc"    (AES-256-GCM)
 *   blob id    <- "trustweb-backup/v1/id"     (32 bytes, hex)
 *   write token<- "trustweb-backup/v1/token"  (32 bytes, hex)
 *
 * Passphrase -> key: NFKC-normalise, then PBKDF2-SHA256 with 600000 iterations and a FIXED
 * application salt. A per-person salt would have to be stored somewhere, which would break
 * "restore needs only what the person remembers". The cost of the fixed salt: an attacker who
 * obtains a stored blob can test passphrases offline against it (every user shares the salt, so
 * no precomputation is spared except per-user targeting). The iteration count and the minimum
 * length are the defence; a random recovery key has no such weakness.
 *
 * Ciphertext layout: [version byte 0x01][12-byte random IV][AES-GCM ciphertext + 16-byte tag].
 * AAD (additional authenticated data) = version byte followed by the UTF-8 blob id, so a blob
 * cannot be replayed under a different id. The IV is fresh per backup (the key is reused).
 * Plaintext is JSON {v, at, data}. Blob length leaks the approximate record size.
 */

export interface BackupKey {
  readonly text: string
  readonly fromPassphrase: boolean
}

export class BackupNotFound extends Error {
  constructor(message = 'No backup was found for this key') {
    super(message)
    this.name = 'BackupNotFound'
  }
}

enum KeyKind {
  Random = 'R',
  Passphrase = 'P',
}

enum Info {
  Enc = 'trustweb-backup/v1/enc',
  Id = 'trustweb-backup/v1/id',
  Token = 'trustweb-backup/v1/token',
}

const KEY_BYTES = 32
const KEY_PREFIX = 'TW1'
const KEY_CHARS = 52
const CHECK_CHARS = 3
const GROUP = 5
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PBKDF2_ITERATIONS = 600_000
const PBKDF2_SALT = 'trustweb-backup/v1/passphrase-salt'
const MIN_PASSPHRASE_CODEPOINTS = 12
const FORMAT_VERSION = 1
const IV_BYTES = 12
const DEFAULT_BASE = '/backup/'

interface Derived {
  readonly encKey: CryptoKey
  readonly id: string
  readonly token: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Copy into a fresh ArrayBuffer so BufferSource typing holds across TS versions. */
function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function crc16(bytes: Uint8Array): number {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

function checkValue(kind: KeyKind, key: Uint8Array): number {
  const input = new Uint8Array(key.length + 1)
  input[0] = kind.charCodeAt(0)
  input.set(key, 1)
  return crc16(input) & 0x7fff // 15 bits = 3 base32 characters
}

function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

/** Returns null on an invalid character or non-zero padding (non-canonical text). */
function base32Decode(chars: string, byteLength: number): Uint8Array | null {
  const out = new Uint8Array(byteLength)
  let acc = 0
  let bits = 0
  let pos = 0
  for (const ch of chars) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) {
      if (pos >= byteLength) return null
      out[pos++] = (acc >>> (bits - 8)) & 255
      bits -= 8
      acc &= (1 << bits) - 1
    }
  }
  if (pos !== byteLength || acc !== 0) return null
  return out
}

function formatKey(kind: KeyKind, key: Uint8Array): string {
  const body = base32Encode(key)
  const check = checkValue(kind, key)
  const checkText = ALPHABET[(check >>> 10) & 31] + ALPHABET[(check >>> 5) & 31] + ALPHABET[check & 31]
  const all = body + checkText
  const groups: string[] = []
  for (let i = 0; i < all.length; i += GROUP) groups.push(all.slice(i, i + GROUP))
  return `${KEY_PREFIX}${kind}-${groups.join('-')}`
}

interface ParsedKey {
  readonly kind: KeyKind
  readonly bytes: Uint8Array
}

function decodeKeyText(text: string): ParsedKey {
  const bad = (): Error => new Error('This recovery key is not valid. Check it for typing mistakes.')
  const compact = text.toUpperCase().replace(/[\s-]+/g, '')
  if (!compact.startsWith(KEY_PREFIX) || compact.length !== KEY_PREFIX.length + 1 + KEY_CHARS + CHECK_CHARS) throw bad()
  const kindChar = compact[KEY_PREFIX.length]
  const kind = kindChar === KeyKind.Random ? KeyKind.Random : kindChar === KeyKind.Passphrase ? KeyKind.Passphrase : null
  if (kind === null) throw bad()
  // Crockford forgiveness: O reads as 0, I and L read as 1.
  const rest = compact
    .slice(KEY_PREFIX.length + 1)
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  const bytes = base32Decode(rest.slice(0, KEY_CHARS), KEY_BYTES)
  if (bytes === null) throw bad()
  let check = 0
  for (const ch of rest.slice(KEY_CHARS)) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw bad()
    check = (check << 5) | v
  }
  if (check !== checkValue(kind, bytes)) throw bad()
  return { kind, bytes }
}

export async function newRandomKey(): Promise<BackupKey> {
  const bytes = new Uint8Array(KEY_BYTES)
  crypto.getRandomValues(bytes)
  return { text: formatKey(KeyKind.Random, bytes), fromPassphrase: false }
}

export async function keyFromPassphrase(passphrase: string): Promise<BackupKey> {
  const normalised = passphrase.normalize('NFKC')
  if (Array.from(normalised).length < MIN_PASSPHRASE_CODEPOINTS) {
    throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE_CODEPOINTS} characters. A few unrelated words work well.`)
  }
  const base = await crypto.subtle.importKey('raw', buf(enc.encode(normalised)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(enc.encode(PBKDF2_SALT)), iterations: PBKDF2_ITERATIONS },
    base,
    KEY_BYTES * 8,
  )
  return { text: formatKey(KeyKind.Passphrase, new Uint8Array(bits)), fromPassphrase: true }
}

export function parseKeyText(text: string): BackupKey {
  const parsed = decodeKeyText(text)
  return { text: formatKey(parsed.kind, parsed.bytes), fromPassphrase: parsed.kind === KeyKind.Passphrase }
}

async function derive(key: BackupKey): Promise<Derived> {
  const { bytes } = decodeKeyText(key.text)
  const hkdfKey = await crypto.subtle.importKey('raw', buf(bytes), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info: Info): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new ArrayBuffer(0),
    info: buf(enc.encode(info)),
  })
  const encKey = await crypto.subtle.deriveKey(params(Info.Enc), hkdfKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const id = toHex(new Uint8Array(await crypto.subtle.deriveBits(params(Info.Id), hkdfKey, 256)))
  const token = toHex(new Uint8Array(await crypto.subtle.deriveBits(params(Info.Token), hkdfKey, 256)))
  return { encKey, id, token }
}

function aad(id: string): ArrayBuffer {
  const idBytes = enc.encode(id)
  const out = new Uint8Array(1 + idBytes.length)
  out[0] = FORMAT_VERSION
  out.set(idBytes, 1)
  return buf(out)
}

function endpoint(base: string, id: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${id}`
}

export async function backupNow(
  key: BackupKey,
  payload: unknown,
  base: string = DEFAULT_BASE,
): Promise<{ at: number; bytes: number }> {
  const { encKey, id, token } = await derive(key)
  const at = Date.now()
  const plain = enc.encode(JSON.stringify({ v: FORMAT_VERSION, at, data: payload }))
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: aad(id) }, encKey, buf(plain)),
  )
  const blob = new Uint8Array(1 + IV_BYTES + cipher.length)
  blob[0] = FORMAT_VERSION
  blob.set(iv, 1)
  blob.set(cipher, 1 + IV_BYTES)
  const res = await fetch(endpoint(base, id), {
    method: 'PUT',
    headers: { 'X-Write-Token': token, 'Content-Type': 'application/octet-stream' },
    body: buf(blob),
  })
  if (res.status === 403) throw new Error('The server refused this key for this backup slot')
  if (res.status === 413) throw new Error('The backup is too large for the server (limit 1 MB)')
  if (res.status === 429) throw new Error('Too many attempts. Try again in a minute')
  if (!res.ok) throw new Error(`Backup failed (server answered ${res.status})`)
  return { at, bytes: blob.length }
}

export async function restore(key: BackupKey, base: string = DEFAULT_BASE): Promise<unknown> {
  const { encKey, id } = await derive(key)
  const res = await fetch(endpoint(base, id), { method: 'GET', cache: 'no-store' })
  if (res.status === 404) throw new BackupNotFound()
  if (res.status === 429) throw new Error('Too many attempts. Try again in a minute')
  if (!res.ok) throw new Error(`Restore failed (server answered ${res.status})`)
  const blob = new Uint8Array(await res.arrayBuffer())
  if (blob.length < 1 + IV_BYTES + 16 || blob[0] !== FORMAT_VERSION) throw new Error('The backup has an unknown format')
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(blob.subarray(1, 1 + IV_BYTES)), additionalData: aad(id) },
      encKey,
      buf(blob.subarray(1 + IV_BYTES)),
    )
  } catch {
    throw new Error('The backup could not be decrypted: it is damaged or was changed')
  }
  const envelope: unknown = JSON.parse(dec.decode(plain))
  if (typeof envelope !== 'object' || envelope === null || !('data' in envelope)) {
    throw new Error('The backup has an unknown format')
  }
  return (envelope as { data: unknown }).data
}
