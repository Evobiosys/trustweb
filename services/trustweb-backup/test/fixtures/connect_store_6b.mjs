// FROZEN COPY of connect_store.mjs as of 206c1d7 (wave 6b, before aliases); only the import path changed. test/aliases.test.mjs loads files written by the
// new code in it, to prove that a rollback of the service code keeps the names readable. Do not edit it; it is not a service module.
// Disk layer of the connect codes and usernames (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
//   <file>  {"v":1,"codes":{"<code>":{"h":"<sha256 hex of the secret>","url":"<long connect url>","seen":<ms>,"name":"<optional>"}}}
//   mode 0600, rewritten atomically (temp file, fsync, rename), writes serialised through one promise queue.
//
// Everything lives in memory (at most `max` codes). Each mutation (secret check, uniqueness check, change) is ONE synchronous block with no
// await in it; only the file write is awaited, and a failed write rolls the change back. Two requests therefore never interleave a change.
//
// SECRETS: only sha256(secret) is kept; it is compared with crypto.timingSafeEqual on two 32-byte buffers. An unknown or expired code is
// checked against a fixed dummy hash, so the presented secret is hashed and compared either way and the two failures take the same work.
//
// LOGGING: none. This module has no logger and never writes to stdout/stderr, by construction (test/connect.test.mjs scans this source and
// captures the process output): a code, a secret, a name and a url are capabilities.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { CODE_RE, isNameShape } from '../../connect_names.mjs'

export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
const HASH_RE = /^[0-9a-f]{64}$/
/** What an unknown code is compared against: the presented secret is hashed and compared in constant time either way. */
const DUMMY_HASH = Buffer.alloc(32)

/** 16 random bytes as 22 base64url characters (128 bits). */
export const newCode = () => crypto.randomBytes(16).toString('base64url')
/** 32 random bytes as 43 base64url characters. */
export const newSecret = () => crypto.randomBytes(32).toString('base64url')

const hashSecret = (secret) => crypto.createHash('sha256').update(secret, 'utf8').digest()

const isEntry = (code, e) =>
  CODE_RE.test(code) && e !== null && typeof e === 'object' && typeof e.h === 'string' && HASH_RE.test(e.h) && typeof e.url === 'string' && Number.isFinite(e.seen)

/**
 * Opens (or creates) the store. Resolves the store object; its `recovered` is true when the file did not parse and was moved
 * aside to <file>.unreadable (the store then starts empty). Rejects when the file cannot be read or written: the caller treats that as "off".
 * ttlMs counts from the last use; touchMs is how old `seen` must be before an open refreshes it (and rewrites the file).
 */
export async function createConnectStore({ file, ttlMs, touchMs, max, now = Date.now }) {
  const codes = new Map() // code -> {h, url, seen, name?}
  const names = new Map() // name -> code
  let recovered = false
  let chain = Promise.resolve()

  async function load() {
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.codes !== 'object' || parsed.codes === null) {
      recovered = true
      await fs.rename(file, `${file}.unreadable`)
      return
    }
    for (const [code, e] of Object.entries(parsed.codes)) if (isEntry(code, e) && !expired(e)) index(code, normalise(e))
  }

  /** A loaded entry without a usable or unique name loses the name, never the code. */
  function normalise(e) {
    return { h: e.h, url: e.url, seen: e.seen, ...(typeof e.name === 'string' ? { name: e.name } : {}) }
  }

  function index(code, entry) {
    if (entry.name !== undefined && (!isNameShape(entry.name) || names.has(entry.name))) delete entry.name
    codes.set(code, entry)
    if (entry.name !== undefined) names.set(entry.name, code)
  }

  function unindex(code) {
    const entry = codes.get(code)
    if (entry === undefined) return
    codes.delete(code)
    if (entry.name !== undefined && names.get(entry.name) === code) names.delete(entry.name)
  }

  /** Write + fsync + rename of the whole map. Writes run one after the other; each snapshots the map when it starts. */
  function persist() {
    const run = async () => {
      const tmp = `${file}.tmp`
      const handle = await fs.open(tmp, 'w', 0o600)
      try {
        await handle.chmod(0o600)
        await handle.writeFile(JSON.stringify({ v: 1, codes: Object.fromEntries(codes) }))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(tmp, file)
    }
    const next = chain.then(run, run)
    chain = next.catch(() => undefined)
    return next
  }

  const background = () => persist().catch(() => undefined)
  const expired = (entry) => entry.seen + ttlMs <= now()

  /** The live entry of `code`, or undefined (unknown, malformed, or expired but not yet swept: those act as unknown). */
  function live(code) {
    const entry = typeof code === 'string' ? codes.get(code) : undefined
    return entry === undefined || expired(entry) ? undefined : entry
  }

  /** Does `secret` open `entry`? Always hashes and compares, whether or not the code exists. */
  function secretOpens(entry, secret) {
    const equal = crypto.timingSafeEqual(hashSecret(secret), entry === undefined ? DUMMY_HASH : Buffer.from(entry.h, 'hex'))
    return entry !== undefined && equal
  }

  function dropExpired() {
    let n = 0
    for (const [code, e] of codes) {
      if (expired(e)) {
        unindex(code)
        n += 1
      }
    }
    return n
  }

  function freshCode() {
    let code = newCode()
    while (codes.has(code)) code = newCode()
    return code
  }

  /** Persists after a synchronous change; on failure runs `rollback` and rethrows. */
  async function commit(rollback) {
    try {
      await persist()
    } catch (err) {
      rollback()
      throw err
    }
  }

  await load()
  dropExpired()
  await persist() // proves the file can be written (else the caller turns the feature off) and leaves it at 0600

  return {
    recovered,
    size: () => codes.size,

    /** Stores a new code for `url` with sha256(secret). Resolves {kind: 'created', code} or {kind: 'full'}. Rejects when the file cannot be written (rolled back). */
    async mint(url, secret) {
      const dropped = dropExpired()
      if (codes.size >= max) {
        if (dropped > 0) background()
        return { kind: 'full' }
      }
      const code = freshCode()
      index(code, { h: hashSecret(secret).toString('hex'), url, seen: now() })
      await commit(() => unindex(code))
      return { kind: 'created', code }
    },

    /** Replaces the url of `code` when `secret` opens it. Resolves {kind: 'updated'} or {kind: 'forbidden'} (unknown, expired and wrong secret alike). */
    async update(code, secret, url) {
      const entry = live(code)
      if (!secretOpens(entry, secret)) return { kind: 'forbidden' }
      const before = { url: entry.url, seen: entry.seen }
      entry.url = url
      entry.seen = now()
      await commit(() => Object.assign(entry, before))
      return { kind: 'updated' }
    },

    /**
     * Claims `name` for `code` ('' releases). A code holding another name gives it up in the same change. Resolves {kind: 'named'} (also when the code
     * already owns it), {kind: 'taken'} or {kind: 'forbidden'}. The secret is checked before availability, so nobody without it learns what is taken.
     */
    async setName(code, secret, name) {
      const entry = live(code)
      if (!secretOpens(entry, secret)) return { kind: 'forbidden' }
      const owner = name === '' ? undefined : names.get(name)
      if (owner !== undefined && owner !== code) {
        if (live(owner) !== undefined) return { kind: 'taken' }
        unindex(owner) // an expired owner that the sweep has not reached yet gives its name up with its code
      }
      if ((entry.name ?? '') === name) return { kind: 'named' }
      const before = { name: entry.name, seen: entry.seen }
      if (entry.name !== undefined) names.delete(entry.name)
      if (name === '') delete entry.name
      else {
        entry.name = name
        names.set(name, code)
      }
      entry.seen = now()
      await commit(() => {
        if (entry.name !== undefined && names.get(entry.name) === code) names.delete(entry.name)
        if (before.name === undefined) delete entry.name
        else {
          entry.name = before.name
          names.set(before.name, code)
        }
        entry.seen = before.seen
      })
      return { kind: 'named' }
    },

    /** The stored url of a live code, or null. An open refreshes `seen` only when it is older than touchMs (a rewrite per open would be a write amplifier). */
    open(code) {
      const entry = live(code)
      if (entry === undefined) return null
      if (now() - entry.seen > touchMs) {
        entry.seen = now()
        background()
      }
      return entry.url
    },

    /** The code that owns `name`, or null (unknown name, or an owner that expired). Exact match only. */
    codeOf(name) {
      const code = typeof name === 'string' ? names.get(name) : undefined
      return code !== undefined && live(code) !== undefined ? code : null
    },

    /** The stored url of a live code without touching `seen`, or null. */
    peek(code) {
      return live(code)?.url ?? null
    },

    /** Drops every expired code (and its name) and rewrites the file when any went. Returns how many. */
    async prune() {
      const n = dropExpired()
      if (n > 0) await persist()
      return n
    },
  }
}
