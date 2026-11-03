// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * keystore.ts -- where a device's sync private key lives at rest.
 *
 * WHY: in v1 the X25519 secret sat as base64url bytes inside the localStorage blob. Anything that can read localStorage (an
 * extension, a stray script, a copied browser profile, a backup of the blob) could copy those bytes and become the device. IndexedDB
 * can hold a CryptoKey OBJECT: a key generated or imported with `extractable: false` is stored by the browser's structured clone
 * and comes back still non-extractable, so no JavaScript, ours included, can ever read its bytes again. After
 * `migrateSecretToKeyStore` has moved a v1 secret into the store (and the caller has rewritten the blob without it), the secret
 * bytes exist nowhere any more; only the key object does.
 *
 *  - `memoryKeyStore`: for tests and for environments without persistence.
 *  - `indexedDbKeyStore`: one record `{ publicKey, privateKey }` under one key in one object store; each call opens and closes its
 *    own connection, writes resolve only when the transaction has completed. No IndexedDB → every call rejects (the caller decides
 *    what to do; it is never silently replaced by localStorage).
 *  - `migrateSecretToKeyStore`: v1 blob secret → non-extractable key in the store; idempotent. If the store holds a DIFFERENT key,
 *    the v1 secret wins and replaces it, because the v1 blob's pairings were made with the v1 key.
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - IndexedDB is per origin and NOT encrypted at rest by the browser. What the browser writes to disk for a non-extractable key is
 *    implementation-specific; someone with the disk / browser profile may well recover it. "Non-extractable" binds JavaScript,
 *    not the file system.
 *  - A device that an attacker has unlocked, or a script running in our origin (XSS), can still USE the key (deriveBits), even
 *    though it cannot read it. Non-extractable stops copying the key off the device, not misuse on the device.
 *  - No OS keystore, no secure enclave / TPM, no passphrase wrapping. Clearing site data deletes the key (and with it the pairings).
 */
import { equalBytes, fromB64u } from './bytes.ts'
import { deviceKeysFromPrivateKey, deviceKeysFromSecret } from './keys.ts'
import type { DeviceKeys } from './keys.ts'

const KEY_LEN = 32

export interface StoredDeviceKey {
  publicKey: Uint8Array
  privateKey: CryptoKey
}

export interface KeyStore {
  /** The stored key, or null when none is stored. Rejects when the store is unavailable or the record is malformed. */
  load(): Promise<StoredDeviceKey | null>
  save(k: StoredDeviceKey): Promise<void>
  clear(): Promise<void>
}

function isStoredKey(v: unknown): v is StoredDeviceKey {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.publicKey instanceof Uint8Array &&
    r.publicKey.length === KEY_LEN &&
    typeof CryptoKey !== 'undefined' &&
    r.privateKey instanceof CryptoKey &&
    r.privateKey.type === 'private' &&
    r.privateKey.algorithm.name === 'X25519'
  )
}

function checked(k: StoredDeviceKey): StoredDeviceKey {
  if (!isStoredKey(k)) throw new Error('key store: expected { publicKey: 32 bytes, privateKey: X25519 private CryptoKey }')
  return { publicKey: Uint8Array.from(k.publicKey), privateKey: k.privateKey }
}

/** In-memory store (tests, no persistence). Public keys are copied in and out. */
export function memoryKeyStore(): KeyStore {
  let held: StoredDeviceKey | null = null
  return {
    async load() {
      return held && { publicKey: Uint8Array.from(held.publicKey), privateKey: held.privateKey }
    },
    async save(k) {
      held = checked(k)
    },
    async clear() {
      held = null
    },
  }
}

export interface IndexedDbKeyStoreOptions {
  /** Default 'trustweb-device-sync'. */
  dbName?: string
  /** Default 'keys'. */
  storeName?: string
  /** Default 'device'. */
  key?: string
  /** Default globalThis.indexedDB. */
  indexedDB?: IDBFactory
}

const DB_VERSION = 1

function reqError(r: { error?: unknown } | null | undefined, what: string): Error {
  const e = r?.error
  if (e instanceof Error) return e
  if (e && typeof e === 'object' && 'message' in e) return new Error(`${what}: ${String((e as { message: unknown }).message)}`)
  return new Error(`${what} failed`)
}

/** A KeyStore over IndexedDB. The CryptoKey object itself is stored; the structured clone keeps it non-extractable. */
export function indexedDbKeyStore(opts: IndexedDbKeyStoreOptions = {}): KeyStore {
  const dbName = opts.dbName ?? 'trustweb-device-sync'
  const storeName = opts.storeName ?? 'keys'
  const key = opts.key ?? 'device'

  function factory(): IDBFactory {
    const f = opts.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
    if (!f) throw new Error('key store: IndexedDB is not available in this environment')
    return f
  }

  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let r: IDBOpenDBRequest
      try {
        r = factory().open(dbName, DB_VERSION)
      } catch (e) {
        reject(e)
        return
      }
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName)
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(reqError(r, 'key store: opening IndexedDB'))
      r.onblocked = () => reject(new Error('key store: IndexedDB open is blocked by another connection'))
    })
  }

  /** Runs one request in one transaction; resolves with the request's result once the TRANSACTION has completed. */
  async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        let result: T
        let settled = false
        const fail = (e: Error): void => {
          if (!settled) {
            settled = true
            reject(e)
          }
        }
        try {
          const tx = db.transaction(storeName, mode)
          const r = op(tx.objectStore(storeName))
          r.onsuccess = () => {
            result = r.result as T
          }
          r.onerror = () => fail(reqError(r, 'key store: IndexedDB request'))
          tx.oncomplete = () => {
            if (!settled) {
              settled = true
              resolve(result)
            }
          }
          tx.onerror = () => fail(reqError(tx, 'key store: IndexedDB transaction'))
          tx.onabort = () => fail(reqError(tx, 'key store: IndexedDB transaction aborted'))
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)))
        }
      })
    } finally {
      db.close()
    }
  }

  return {
    async load() {
      const v = await run<unknown>('readonly', (s) => s.get(key))
      if (v === undefined) return null
      if (!isStoredKey(v)) throw new Error('key store: the stored record is malformed')
      return { publicKey: Uint8Array.from(v.publicKey), privateKey: v.privateKey }
    },
    async save(k) {
      const rec = checked(k)
      await run<unknown>('readwrite', (s) => s.put(rec, key))
    },
    async clear() {
      await run<unknown>('readwrite', (s) => s.delete(key))
    },
  }
}

/**
 * The migration from the v1 blob: import the raw secret as a NON-extractable X25519 key, save it with its public key, return
 * DeviceKeys WITHOUT secretKey. Idempotent: a store that already holds the same public key keeps its key (nothing is written).
 * A store holding a different key is overwritten (see the module header). A bad secret rejects before the store is touched.
 * The caller must still remove the secret from the v1 blob; until it does, the bytes exist there.
 */
export async function migrateSecretToKeyStore(store: KeyStore, secretKeyB64u: string): Promise<DeviceKeys> {
  const raw = fromB64u(secretKeyB64u)
  // deviceKeysFromSecret imports the private key non-extractable; its `secretKey` copy is dropped (zeroed) here.
  const fromRaw = await deviceKeysFromSecret(raw)
  fromRaw.secretKey?.fill(0)
  raw.fill(0)
  const existing = await store.load()
  if (existing && equalBytes(existing.publicKey, fromRaw.publicKey)) {
    return deviceKeysFromPrivateKey(existing.privateKey, existing.publicKey)
  }
  await store.save({ publicKey: fromRaw.publicKey, privateKey: fromRaw.privateKey })
  return { deviceId: fromRaw.deviceId, publicKey: fromRaw.publicKey, privateKey: fromRaw.privateKey }
}
