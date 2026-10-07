// Disk layer of the short connect links (wave 5; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, "Short links").
//
//   <file>  {"v":1,"links":{"<id>":{"url":"<long connect url>","expires_at":<ms>}}}     mode 0600, rewritten atomically
//
// Everything lives in memory (at most `max` entries) and the whole file is rewritten on every change: write to <file>.tmp
// (0600), fsync, rename. A crash leaves the old or the new file, never a torn one.
//
// LOGGING: this module has no logger and never writes to stdout/stderr, by construction. The id and the url are capabilities
// (the url is what the QR already shows); test/links.test.mjs scans this source for any console or stream use and captures
// the process output across a full run.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const ID_LENGTH = 10
export const ID_RE = /^[A-Za-z0-9]{10}$/
/** A repeated POST of the same url reuses the live link only while it still has this long to live; otherwise it gets a fresh one. */
export const REUSE_MIN_LEFT_MS = 86_400_000

/** 10 random characters from [A-Za-z0-9] (about 59.5 bits). crypto.randomInt draws without modulo bias. */
export function newLinkId() {
  let id = ''
  for (let i = 0; i < ID_LENGTH; i += 1) id += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return id
}

const urlKey = (url) => crypto.createHash('sha256').update(url, 'utf8').digest('hex')
const isEntry = (id, e) => ID_RE.test(id) && e !== null && typeof e === 'object' && typeof e.url === 'string' && Number.isFinite(e.expires_at)

/**
 * Opens (or creates) the store. Resolves {store, recovered}. `recovered` is true when the file did not parse and was moved
 * aside to <file>.unreadable (the store then starts empty). Rejects when the file cannot be read or written: the caller treats that as "links off".
 */
export async function createLinkStore({ file, ttlMs, max, now = Date.now }) {
  const links = new Map() // id -> {url, expires_at}
  const byUrl = new Map() // sha256(url) -> id of the newest link for that url
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
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.links !== 'object' || parsed.links === null) {
      recovered = true
      await fs.rename(file, `${file}.unreadable`)
      return
    }
    for (const [id, e] of Object.entries(parsed.links)) if (isEntry(id, e)) index(id, { url: e.url, expires_at: e.expires_at })
  }

  function index(id, entry) {
    links.set(id, entry)
    byUrl.set(urlKey(entry.url), id)
  }

  function unindex(id) {
    const entry = links.get(id)
    if (entry === undefined) return
    links.delete(id)
    const key = urlKey(entry.url)
    if (byUrl.get(key) === id) byUrl.delete(key)
  }

  /** Write + fsync + rename of the whole map. Writes run one after the other; each snapshots the map when it starts. */
  function persist() {
    const run = async () => {
      const tmp = `${file}.tmp`
      const handle = await fs.open(tmp, 'w', 0o600)
      try {
        await handle.chmod(0o600)
        await handle.writeFile(JSON.stringify({ v: 1, links: Object.fromEntries(links) }))
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

  /** Removes the expired entries from memory; returns how many. Does not touch the disk. */
  function dropExpired() {
    const t = now()
    let n = 0
    for (const [id, e] of links) {
      if (e.expires_at <= t) {
        unindex(id)
        n += 1
      }
    }
    return n
  }

  function freshId() {
    let id = newLinkId()
    while (links.has(id)) id = newLinkId()
    return id
  }

  await load()
  dropExpired()
  await persist() // proves the file can be written (else the caller turns links off) and leaves it at 0600

  return {
    recovered,
    size: () => links.size,

    /** The stored url, or null when the id is unknown or expired (an expired one is dropped, its file rewrite follows in the background). */
    get(id) {
      const entry = links.get(id)
      if (entry === undefined) return null
      if (entry.expires_at > now()) return entry.url
      unindex(id)
      persist().catch(() => undefined)
      return null
    },

    /** Forgets one id (a stored url that no longer passes validation). Background rewrite. */
    drop(id) {
      unindex(id)
      persist().catch(() => undefined)
    },

    /**
     * Stores a url. Resolves {kind: 'created' | 'reused' | 'full', id?, expires_at?}. The same url posted again while its link has
     * more than REUSE_MIN_LEFT_MS left gives that link back ('reused'): a retry or a re-shown QR screen does not use up a slot.
     * Rejects when the file cannot be written (the entry is rolled back).
     */
    async add(url) {
      const dropped = dropExpired()
      const t = now()
      const known = byUrl.get(urlKey(url))
      const live = known === undefined ? undefined : links.get(known)
      if (live !== undefined && live.expires_at - t > REUSE_MIN_LEFT_MS) {
        if (dropped > 0) persist().catch(() => undefined)
        return { kind: 'reused', id: known, expires_at: live.expires_at }
      }
      if (links.size >= max) {
        if (dropped > 0) persist().catch(() => undefined)
        return { kind: 'full' }
      }
      const id = freshId()
      const entry = { url, expires_at: t + ttlMs }
      const previous = byUrl.get(urlKey(url))
      index(id, entry)
      try {
        await persist()
      } catch (err) {
        unindex(id)
        if (previous !== undefined && links.has(previous)) byUrl.set(urlKey(url), previous)
        throw err
      }
      return { kind: 'created', id, expires_at: entry.expires_at }
    },

    /** Drops every expired link and rewrites the file when any went. Returns how many. */
    async prune() {
      const n = dropExpired()
      if (n > 0) await persist()
      return n
    },
  }
}
