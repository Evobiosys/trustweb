// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// A small in-memory IDBFactory: only what the photo store uses (open + upgrade, keyPath stores, put/get/getAll/delete/clear, transactions, deleteDatabase).
const later = (fn) => setTimeout(fn, 0)

function request(run) {
  const r = { result: undefined, error: null, onsuccess: null, onerror: null }
  later(() => {
    try { r.result = run(); r.onsuccess?.({ target: r }) } catch (e) { r.error = e; r.onerror?.({ target: r }) }
  })
  return r
}

class Store {
  constructor(keyPath) { this.keyPath = keyPath; this.rows = new Map() }
}

function objectStore(store, tx) {
  const op = (run, write) => { if (write && tx.mode !== 'readwrite') throw new Error('read-only transaction'); tx.pending++; const r = request(run); const done = () => { tx.pending--; tx.settle() }; later(() => later(done)); return r }
  return {
    put: (v) => op(() => { store.rows.set(v[store.keyPath], structuredCloneKeepBlobs(v)); return v[store.keyPath] }, true),
    get: (k) => op(() => { const v = store.rows.get(k); return v === undefined ? undefined : structuredCloneKeepBlobs(v) }),
    getAll: () => op(() => [...store.rows.values()].map(structuredCloneKeepBlobs)),
    delete: (k) => op(() => { store.rows.delete(k) }, true),
    clear: () => op(() => { store.rows.clear() }, true),
  }
}

// structuredClone keeps Blob in Node 22; fall back to the same reference when it cannot clone.
function structuredCloneKeepBlobs(v) { try { return structuredClone(v) } catch { return v } }

export function fakeIndexedDB() {
  const dbs = new Map()
  return {
    open(name, version = 1) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      later(() => {
        let rec = dbs.get(name)
        const fresh = !rec
        if (!rec) { rec = { version, stores: new Map() }; dbs.set(name, rec) }
        const db = {
          onversionchange: null,
          close() {},
          createObjectStore(s, opts) { const st = new Store(opts.keyPath); rec.stores.set(s, st); return objectStore(st, { mode: 'readwrite', pending: 0, settle() {} }) },
          transaction(names, mode = 'readonly') {
            const list = Array.isArray(names) ? names : [names]
            const tx = { mode, pending: 0, oncomplete: null, onerror: null, onabort: null, error: null, objectStore: (n) => { if (!list.includes(n)) throw new Error('not in transaction: ' + n); return objectStore(rec.stores.get(n), tx) } }
            let fired = false
            tx.settle = () => { if (tx.pending === 0 && !fired) later(() => { if (tx.pending === 0 && !fired) { fired = true; tx.oncomplete?.({ target: tx }) } }) }
            later(() => tx.settle())
            return tx
          },
        }
        req.result = db
        if (fresh) req.onupgradeneeded?.({ target: req })
        req.onsuccess?.({ target: req })
      })
      return req
    },
    deleteDatabase(name) { return request(() => { dbs.delete(name) }) },
  }
}
