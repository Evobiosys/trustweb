// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, toB64u } from './bytes.ts'
import { deviceKeysFromPrivateKey, deviceKeysFromSecret, generateDeviceKeys, sharedSecret } from './keys.ts'
import { indexedDbKeyStore, memoryKeyStore, migrateSecretToKeyStore } from './keystore.ts'
import type { KeyStore } from './keystore.ts'

// ---------------------------------------------------------------------------------------------------------------------------
// A minimal fake of the IndexedDB request API: just what keystore.ts uses. Values are stored through structuredClone(), as a
// real IndexedDB does, so a CryptoKey comes back as a clone that is still non-extractable. Events fire asynchronously.
// ---------------------------------------------------------------------------------------------------------------------------
type Handler = ((ev: unknown) => void) | null
interface FakeRequest { result: unknown; error: unknown; onsuccess: Handler; onerror: Handler; onupgradeneeded?: Handler; onblocked?: Handler }
const later = (f: () => void): void => void setTimeout(f, 0)
function request(): FakeRequest {
  return { result: undefined, error: null, onsuccess: null, onerror: null }
}

class FakeDb {
  stores = new Map<string, Map<string, unknown>>()
  version = 0
  closed = 0
  failWrites = false
  objectStoreNames = { contains: (n: string): boolean => this.stores.has(n) }
  createObjectStore(n: string): void {
    this.stores.set(n, new Map())
  }
  close(): void {
    this.closed++
  }
  transaction(name: string, mode: 'readonly' | 'readwrite') {
    const store = this.stores.get(name)
    if (!store) throw new Error(`NotFoundError: no object store ${name}`)
    let pending = 0
    const tx = {
      oncomplete: null as Handler,
      onerror: null as Handler,
      onabort: null as Handler,
      error: null as unknown,
      objectStore: (n: string) => {
        assert.equal(n, name)
        const op = (f: () => unknown, write: boolean): FakeRequest => {
          if (write && mode !== 'readwrite') throw new Error('ReadOnlyError')
          const r = request()
          pending++
          later(() => {
            try {
              r.result = f()
              r.onsuccess?.({ target: r })
            } catch (e) {
              r.error = e
              tx.error = e
              r.onerror?.({ target: r })
              tx.onerror?.({ target: r })
              tx.onabort?.({ target: tx })
              return
            }
            if (--pending === 0) later(() => tx.oncomplete?.({ target: tx }))
          })
          return r
        }
        return {
          get: (k: string) => op(() => (store.has(k) ? structuredClone(store.get(k)) : undefined), false),
          put: (v: unknown, k: string) =>
            op(() => {
              if (this.failWrites) throw new Error('QuotaExceededError: disk full')
              store.set(k, structuredClone(v))
            }, true),
          delete: (k: string) => op(() => void store.delete(k), true),
        }
      },
    }
    return tx
  }
}

class FakeIndexedDb {
  dbs = new Map<string, FakeDb>()
  opens = 0
  open(name: string, version?: number): FakeRequest {
    this.opens++
    const r = request()
    r.onupgradeneeded = null
    later(() => {
      let db = this.dbs.get(name)
      if (!db) this.dbs.set(name, (db = new FakeDb()))
      r.result = db
      const v = version ?? Math.max(1, db.version)
      if (v > db.version) {
        db.version = v
        r.onupgradeneeded?.({ target: r })
      }
      r.onsuccess?.({ target: r })
    })
    return r
  }
}
const fakeIdb = (): { idb: FakeIndexedDb; factory: IDBFactory } => {
  const idb = new FakeIndexedDb()
  return { idb, factory: idb as unknown as IDBFactory }
}

// ---------------------------------------------------------------------------------------------------------------------------

async function storeRoundTrip(store: KeyStore): Promise<void> {
  assert.equal(await store.load(), null)
  const k = await generateDeviceKeys()
  await store.save({ publicKey: k.publicKey, privateKey: k.privateKey })
  const got = await store.load()
  assert.ok(got)
  assert.deepEqual(got.publicKey, k.publicKey)
  assert.equal(got.privateKey.type, 'private')
  assert.equal(got.privateKey.extractable, false)
  await assert.rejects(crypto.subtle.exportKey('pkcs8', got.privateKey))
  // The loaded key is usable: same ECDH result as the original against a second device.
  const other = await generateDeviceKeys()
  const loaded = await deviceKeysFromPrivateKey(got.privateKey, got.publicKey)
  assert.equal(loaded.deviceId, k.deviceId)
  assert.equal(loaded.secretKey, undefined)
  assert.deepEqual(await sharedSecret(loaded, other.publicKey), await sharedSecret(k, other.publicKey))
  assert.deepEqual(await sharedSecret(loaded, other.publicKey), await sharedSecret(other, k.publicKey))
  await store.clear()
  assert.equal(await store.load(), null)
  await store.clear() // clearing an empty store is fine
}

test('memoryKeyStore: round trip, the loaded key works and is not extractable, clear empties it', async () => {
  await storeRoundTrip(memoryKeyStore())
})

test('memoryKeyStore: returns copies of the public key (callers cannot mutate the stored one)', async () => {
  const s = memoryKeyStore()
  const k = await generateDeviceKeys()
  const pub = Uint8Array.from(k.publicKey)
  await s.save({ publicKey: pub, privateKey: k.privateKey })
  pub[0] ^= 1
  const a = await s.load()
  assert.deepEqual(a!.publicKey, k.publicKey)
  a!.publicKey[0] ^= 1
  assert.deepEqual((await s.load())!.publicKey, k.publicKey)
})

test('memoryKeyStore / indexedDbKeyStore: save rejects a malformed key', async () => {
  const k = await generateDeviceKeys()
  for (const s of [memoryKeyStore(), indexedDbKeyStore({ indexedDB: fakeIdb().factory })]) {
    await assert.rejects(s.save({ publicKey: new Uint8Array(31), privateKey: k.privateKey }))
    await assert.rejects(s.save({ publicKey: k.publicKey, privateKey: null as unknown as CryptoKey }))
  }
})

test('indexedDbKeyStore (fake IDB): round trip through structured clone; upgrade creates the store once; connections closed', async () => {
  const { idb, factory } = fakeIdb()
  await storeRoundTrip(indexedDbKeyStore({ indexedDB: factory }))
  const db = idb.dbs.get('trustweb-device-sync')
  assert.ok(db, 'default db name')
  assert.ok(db.stores.has('keys'), 'default store name')
  assert.equal(db.closed, idb.opens, 'every connection opened is closed again')
})

test('indexedDbKeyStore (fake IDB): what is stored is a CryptoKey object and the public key, never secret bytes', async () => {
  const { idb, factory } = fakeIdb()
  const store = indexedDbKeyStore({ indexedDB: factory, dbName: 'db1', storeName: 's1', key: 'k1' })
  const k = await generateDeviceKeys()
  await store.save({ publicKey: k.publicKey, privateKey: k.privateKey })
  const raw = idb.dbs.get('db1')!.stores.get('s1')!.get('k1') as Record<string, unknown>
  assert.deepEqual(Object.keys(raw).sort(), ['privateKey', 'publicKey'])
  assert.ok(raw.privateKey instanceof CryptoKey)
  assert.equal((raw.privateKey as CryptoKey).extractable, false)
  // A second store object on the same database sees the key (persistence across page loads).
  const again = await indexedDbKeyStore({ indexedDB: factory, dbName: 'db1', storeName: 's1', key: 'k1' }).load()
  assert.deepEqual(again!.publicKey, k.publicKey)
  // Different key name in the same store: empty.
  assert.equal(await indexedDbKeyStore({ indexedDB: factory, dbName: 'db1', storeName: 's1', key: 'other' }).load(), null)
})

test('indexedDbKeyStore: a malformed stored record makes load reject (it is not silently treated as "no key")', async () => {
  const { idb, factory } = fakeIdb()
  const store = indexedDbKeyStore({ indexedDB: factory })
  await store.clear() // creates the database
  idb.dbs.get('trustweb-device-sync')!.stores.get('keys')!.set('device', { publicKey: 'nope', privateKey: 1 })
  await assert.rejects(store.load(), /malformed/)
})

test('indexedDbKeyStore: no IndexedDB available → load/save/clear reject with a clear message', async () => {
  const saved = (globalThis as { indexedDB?: unknown }).indexedDB
  assert.equal(saved, undefined, 'Node has no IndexedDB')
  const store = indexedDbKeyStore()
  const k = await generateDeviceKeys()
  await assert.rejects(store.load(), /IndexedDB is not available/)
  await assert.rejects(store.save({ publicKey: k.publicKey, privateKey: k.privateKey }), /IndexedDB is not available/)
  await assert.rejects(store.clear(), /IndexedDB is not available/)
})

test('indexedDbKeyStore: an open error rejects', async () => {
  const failing = {
    open(): FakeRequest {
      const r = request()
      later(() => {
        r.error = new Error('QuotaExceededError')
        r.onerror?.({ target: r })
      })
      return r
    },
  } as unknown as IDBFactory
  await assert.rejects(indexedDbKeyStore({ indexedDB: failing }).load(), /QuotaExceededError/)
})

test('indexedDbKeyStore: a failing put rejects instead of resolving', async () => {
  const { idb, factory } = fakeIdb()
  const store = indexedDbKeyStore({ indexedDB: factory })
  await store.clear() // creates the database
  idb.dbs.get('trustweb-device-sync')!.failWrites = true
  const k = await generateDeviceKeys()
  await assert.rejects(store.save({ publicKey: k.publicKey, privateKey: k.privateKey }), /QuotaExceededError/)
  assert.equal(await store.load(), null)
})

test('migrateSecretToKeyStore: same deviceId/publicKey as deviceKeysFromSecret, no secretKey, key saved non-extractable', async () => {
  const secret = randomBytes(32)
  const ref = await deviceKeysFromSecret(secret)
  const store = memoryKeyStore()
  const m = await migrateSecretToKeyStore(store, toB64u(secret))
  assert.equal(m.deviceId, ref.deviceId)
  assert.deepEqual(m.publicKey, ref.publicKey)
  assert.equal(m.secretKey, undefined)
  assert.ok(!('secretKey' in m))
  assert.equal(m.privateKey.extractable, false)
  const stored = await store.load()
  assert.deepEqual(stored!.publicKey, ref.publicKey)
  assert.equal(stored!.privateKey.extractable, false)
  await assert.rejects(crypto.subtle.exportKey('pkcs8', stored!.privateKey))
  const peer = await generateDeviceKeys()
  assert.deepEqual(await sharedSecret(m, peer.publicKey), await sharedSecret(ref, peer.publicKey))
})

test('migrateSecretToKeyStore: idempotent -- a store already holding the same public key keeps its key', async () => {
  const secret = randomBytes(32)
  const store = memoryKeyStore()
  await migrateSecretToKeyStore(store, toB64u(secret))
  const first = await store.load()
  let saves = 0
  const counting: KeyStore = { load: () => store.load(), clear: () => store.clear(), save: (k) => (saves++, store.save(k)) }
  const m2 = await migrateSecretToKeyStore(counting, toB64u(secret))
  assert.equal(saves, 0, 'nothing rewritten')
  assert.equal((await store.load())!.privateKey, first!.privateKey)
  assert.equal(m2.privateKey, first!.privateKey)
})

test('migrateSecretToKeyStore: a store holding a DIFFERENT key is overwritten by the v1 secret (the pairings belong to it)', async () => {
  const store = memoryKeyStore()
  const other = await generateDeviceKeys()
  await store.save({ publicKey: other.publicKey, privateKey: other.privateKey })
  const secret = randomBytes(32)
  const m = await migrateSecretToKeyStore(store, toB64u(secret))
  assert.deepEqual((await store.load())!.publicKey, (await deviceKeysFromSecret(secret)).publicKey)
  assert.deepEqual(m.publicKey, (await deviceKeysFromSecret(secret)).publicKey)
})

test('migrateSecretToKeyStore: through the fake IndexedDB, and a bad secret rejects without touching the store', async () => {
  const { factory } = fakeIdb()
  const store = indexedDbKeyStore({ indexedDB: factory })
  await assert.rejects(migrateSecretToKeyStore(store, 'not*b64u'))
  await assert.rejects(migrateSecretToKeyStore(store, toB64u(randomBytes(16))))
  assert.equal(await store.load(), null)
  const secret = randomBytes(32)
  const m = await migrateSecretToKeyStore(store, toB64u(secret))
  const loaded = await store.load()
  const back = await deviceKeysFromPrivateKey(loaded!.privateKey, loaded!.publicKey)
  assert.equal(back.deviceId, m.deviceId)
  assert.equal(back.secretKey, undefined)
})
