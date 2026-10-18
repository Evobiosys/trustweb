// Disk layer of the connect codes and usernames (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
//   <file>  {"v":1,"codes":{"<code>":{"h":"<sha256 hex of the secret>","url":"<long connect url>","seen":<ms>,"name":"<optional primary>","aliases":["<optional>", ...]}}}
//           (wave 6e: up to two aliases beside the primary `name`; the rules are in connect_aliases.mjs. `aliases` is absent when empty, so a file
//           written here still loads in the 6b store, which keeps the primary and ignores the aliases.)
//           wave 15: beside `codes` two more maps: "claims" {"<address key>":[ms, ...]} (names claimed per address in the cap window) and "released"
//           {"<name>":{"at":<ms>,"code":"<former holder>"}} (a freed name rests REST_MS for everyone but its former holder; kept PREV_MS). A code entry
//           may carry "previousHolderAt" (when the former holder of its claimed name let go). Older builds ignore all three.
//           wave 15 (devices): "moved" {"<name>":<ms>} (when a name last moved between two codes of one account, once per MOVE_MS). Older builds ignore it.
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
import { answerFor, fieldsFor, MAX_NAMES, namesOf, planClaim, planGrant, planMove, planRelease, planRemove } from './connect_aliases.mjs'
import { CODE_RE, confusableKey, isNameShape, isReserved } from './connect_names.mjs'

/** A freed name rests this long before another code may claim it; the cap counts claims in this window; a code shows "name had a previous holder" this long. */
export const REST_MS = 30 * 86_400_000
export const CAP_WINDOW_MS = 30 * 86_400_000
export const PREV_MS = 180 * 86_400_000
/** A name moves between the codes of one account at most once in this window. */
export const MOVE_MS = 30 * 86_400_000

export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
const HASH_RE = /^[0-9a-f]{64}$/
/** What an unknown code is compared against: the presented secret is hashed and compared in constant time either way. */
const DUMMY_HASH = Buffer.alloc(32)

/** 16 random bytes as 22 base64url characters (128 bits). */
export const newCode = () => crypto.randomBytes(16).toString('base64url')
/** 32 random bytes as 43 base64url characters. */
export const newSecret = () => crypto.randomBytes(32).toString('base64url')

export const hashSecret = (secret) => crypto.createHash('sha256').update(secret, 'utf8').digest()

/** Does `secret` match the sha256 hex `hash`? Always hashes and compares (an undefined hash against a dummy), so unknown and wrong take the same work. */
export function hashMatches(hash, secret) {
  const equal = crypto.timingSafeEqual(hashSecret(secret), hash === undefined ? DUMMY_HASH : Buffer.from(hash, 'hex'))
  return hash !== undefined && equal
}

const isEntry = (code, e) =>
  CODE_RE.test(code) && e !== null && typeof e === 'object' && typeof e.h === 'string' && HASH_RE.test(e.h) && typeof e.url === 'string' && Number.isFinite(e.seen)

/** How a planner's refusal reaches the caller (the result `kind`). */
const REFUSALS = Object.freeze({ locked: 'locked', reserved: 'reserved', taken: 'taken', too_many: 'too_many', not_held: 'not_held', alias_cap: 'alias_cap' })

/**
 * Opens (or creates) the store. Resolves the store object; its `recovered` is true when the file did not parse and was moved
 * aside to <file>.unreadable (the store then starts empty). Rejects when the file cannot be read or written: the caller treats that as "off".
 * ttlMs counts from the last use; touchMs is how old `seen` must be before an open refreshes it (and rewrites the file).
 * `reserved` is the reserved-name predicate (built-in list plus the env list): a reserved name that a code holds is LOCKED against the app.
 */
export async function createConnectStore({ file, ttlMs, touchMs, max, now = Date.now, reserved = isReserved }) {
  const codes = new Map() // code -> {h, url, seen, name?, aliases?}
  const names = new Map() // name (primary or alias) -> code
  const claims = new Map() // address key -> [ms of each claim in the cap window]
  const released = new Map() // name -> {at, code}: freed lately
  const moved = new Map() // name -> ms of its last move between codes
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
    for (const [code, e] of Object.entries(parsed.codes)) {
      if (isEntry(code, e) && !expired(e)) index(code, { h: e.h, url: e.url, seen: e.seen, ...(Number.isFinite(e.previousHolderAt) ? { previousHolderAt: e.previousHolderAt } : {}) }, loadedNames(e))
    }
    for (const [addr, list] of Object.entries(parsed.claims ?? {})) if (Array.isArray(list)) claims.set(addr, list.filter(Number.isFinite))
    for (const [n, r] of Object.entries(parsed.released ?? {})) if (isNameShape(n) && r && Number.isFinite(r.at) && typeof r.code === 'string') released.set(n, { at: r.at, code: r.code })
    for (const [n, at] of Object.entries(parsed.moved ?? {})) if (isNameShape(n) && Number.isFinite(at)) moved.set(n, at)
    forget()
  }

  /** Drops what no rule looks at any more: claims older than the cap window, freed names older than PREV_MS. */
  function forget() {
    for (const [addr, list] of claims) {
      const recent = list.filter((t) => t > now() - CAP_WINDOW_MS)
      if (recent.length > 0) claims.set(addr, recent)
      else claims.delete(addr)
    }
    for (const [n, r] of released) if (r.at <= now() - PREV_MS) released.delete(n)
    for (const [n, at] of moved) if (at <= now() - MOVE_MS) moved.delete(n)
  }

  /** The names a loaded entry claims, in order: the primary, then the aliases (anything that is not a string is dropped here, the rest in index). */
  const loadedNames = (e) => [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].filter((n) => typeof n === 'string')

  /**
   * Stores `entry` under `code` with the first usable names of `wanted`: a name of the wrong shape, one held by an earlier code (or earlier in the list)
   * and any past the third loses only itself, never the code. The first survivor is the primary, so a lost primary promotes the first alias.
   */
  function index(code, entry, wanted) {
    const kept = []
    for (const n of wanted) if (isNameShape(n) && !names.has(n) && !kept.includes(n) && kept.length < MAX_NAMES) kept.push(n)
    codes.set(code, { ...entry, ...fieldsFor(kept) })
    for (const n of kept) names.set(n, code)
  }

  function unindex(code) {
    const entry = codes.get(code)
    if (entry === undefined) return
    codes.delete(code)
    for (const n of namesOf(entry)) if (names.get(n) === code) names.delete(n)
  }

  /** Makes `entry` (stored under `code`) hold exactly the ordered names `next`, in the entry and in the name map. */
  function applyNames(code, entry, next) {
    for (const n of namesOf(entry)) if (names.get(n) === code) names.delete(n)
    delete entry.name
    delete entry.aliases
    Object.assign(entry, fieldsFor(next))
    for (const n of next) names.set(n, code)
  }

  /** Write + fsync + rename of the whole map. Writes run one after the other; each snapshots the map when it starts. */
  function persist() {
    const run = async () => {
      const tmp = `${file}.tmp`
      const handle = await fs.open(tmp, 'w', 0o600)
      try {
        await handle.chmod(0o600)
        await handle.writeFile(JSON.stringify({ v: 1, codes: Object.fromEntries(codes), claims: Object.fromEntries(claims), released: Object.fromEntries(released), moved: Object.fromEntries(moved) }))
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
  const secretOpens = (entry, secret) => hashMatches(entry?.h, secret)

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

  const named = (entry) => ({ kind: 'named', ...answerFor(namesOf(entry), reserved) })

  /**
   * Is `name` held by another LIVE code? A holder that expired but has not been swept yet gives its names up with its code (as it always did).
   * Part of a synchronous block: nothing awaits between this check and the change that follows it.
   */
  function takenByOther(code, name) {
    const holder = names.get(name)
    if (holder === undefined || holder === code) return false
    if (live(holder) !== undefined) return true
    unindex(holder)
    return false
  }

  /** Does ANOTHER live code (not `code`, not `also`) hold a name that looks like `name` (confusableKey)? Phishing guard of a claim; a scan, but claims are rare and rate limited. */
  function lookalikeOfOther(code, name, also) {
    const key = confusableKey(name)
    for (const [n, c] of names) if (c !== code && c !== also && confusableKey(n) === key && live(c) !== undefined) return true
    return false
  }

  /**
   * Applies a planner's Outcome to `entry` and persists it. One synchronous change, then the awaited write; a failed write puts the names and the last-use
   * time back (a name that another request took in the meantime stays with that request) and rethrows. Resolves a result {kind, ...}.
   */
  async function change(code, entry, plan, claimed) {
    if (plan.kind === 'noop') return named(entry)
    if (plan.kind !== 'set') return { kind: REFUSALS[plan.kind] }
    const before = { names: namesOf(entry), seen: entry.seen, previousHolderAt: entry.previousHolderAt, released: new Map(released), claims: claimed && claims.get(claimed.addr) }
    applyNames(code, entry, plan.names)
    entry.seen = now()
    for (const n of before.names) if (!plan.names.includes(n)) released.set(n, { at: now(), code })
    if (claimed) {
      const prior = released.get(claimed.name)
      released.delete(claimed.name)
      if (prior !== undefined && prior.code !== code && prior.at > now() - PREV_MS) entry.previousHolderAt = prior.at
      forget()
      claims.set(claimed.addr, [...(claims.get(claimed.addr) ?? []), now()])
    }
    await commit(() => {
      applyNames(code, entry, before.names.filter((n) => names.get(n) === undefined || names.get(n) === code))
      entry.seen = before.seen
      if (before.previousHolderAt === undefined) delete entry.previousHolderAt
      else entry.previousHolderAt = before.previousHolderAt
      released.clear()
      for (const [n, r] of before.released) released.set(n, r)
      if (claimed) before.claims === undefined ? claims.delete(claimed.addr) : claims.set(claimed.addr, before.claims)
    })
    return named(entry)
  }

  /** Is `name` resting after a release by ANOTHER code than `code`? The former holder may reclaim at once. */
  function resting(code, name) {
    const r = released.get(name)
    return r !== undefined && r.code !== code && r.at > now() - REST_MS
  }

  /** The cap check of a claim from `addr`: {until} (ms when the oldest claim leaves the window) when `cap` claims are already in it, else null. */
  function capHit(addr, cap) {
    const recent = (claims.get(addr) ?? []).filter((t) => t > now() - CAP_WINDOW_MS)
    return recent.length >= cap ? { until: Math.min(...recent) + CAP_WINDOW_MS } : null
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
      index(code, { h: hashSecret(secret).toString('hex'), url, seen: now() }, [])
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

    /** The names `code` holds, when `secret` opens it. Changes nothing (no write, no last-use refresh). Resolves {kind: 'named', name, aliases} or {kind: 'forbidden'}. */
    async read(code, secret) {
      const entry = live(code)
      return secretOpens(entry, secret) ? named(entry) : { kind: 'forbidden' }
    },

    /**
     * A CLAIM by the holder of `code`: `name` as the primary, or as an alias when `alias` is true (rules: connect_aliases.mjs planClaim).
     * Resolves {kind: 'named', name, aliases} (also for an idempotent re-claim), {kind: 'locked' | 'reserved' | 'taken' | 'too_many'} or {kind: 'forbidden'}.
     * The secret is checked first, so nobody without it learns what is taken or reserved.
     */
    async claim(code, secret, { name, alias = false, addr, cap = Infinity }) {
      const entry = live(code)
      if (!secretOpens(entry, secret)) return { kind: 'forbidden' }
      const held = namesOf(entry)
      const plan = planClaim({ held, name, alias, reserved, takenByOther: takenByOther(code, name) || resting(code, name) || lookalikeOfOther(code, name) })
      const fresh = plan.kind === 'set' && !held.includes(name) && addr !== undefined // a new name; promoting a held alias is no claim
      const hit = fresh ? capHit(addr, cap) : null
      return hit === null ? change(code, entry, plan, fresh ? { addr, name } : undefined) : { kind: 'name_cap', ...hit }
    },

    /**
     * A MOVE (devices, wave 15): `name` leaves the code `from.code` and joins `code`, as an alias or (as 'primary') the primary, when BOTH secrets open their codes.
     * Both entries change in one synchronous step, one write, and a failed write puts both back. No claim (the cap does not count it), no rest, but one move per
     * name per MOVE_MS. Resolves {kind: 'named', ...} of `code`, {kind: 'forbidden'} (either secret, unknown or expired alike), {kind: 'not_held' | 'alias_cap' | 'taken'}
     * or {kind: 'moved_lately', until}.
     */
    async move(code, secret, { name, from, as }) {
      const entry = live(code)
      const src = live(from.code)
      const opens = [secretOpens(entry, secret), secretOpens(src, from.secret)]
      if (!opens[0] || !opens[1]) return { kind: 'forbidden' }
      if (!namesOf(src).includes(name)) return { kind: 'not_held' }
      const last = moved.get(name)
      if (last !== undefined && last > now() - MOVE_MS) return { kind: 'moved_lately', until: last + MOVE_MS }
      const plan = planMove({ held: namesOf(entry), name, as })
      if (plan.kind !== 'set') return { kind: REFUSALS[plan.kind] }
      if (lookalikeOfOther(code, name, from.code)) return { kind: 'taken' }
      const before = { to: namesOf(entry), from: namesOf(src), seenTo: entry.seen, seenFrom: src.seen, moved: last }
      applyNames(from.code, src, before.from.filter((n) => n !== name))
      applyNames(code, entry, plan.names)
      entry.seen = src.seen = now()
      moved.set(name, now())
      await commit(() => {
        applyNames(code, entry, before.to)
        applyNames(from.code, src, before.from)
        entry.seen = before.seenTo
        src.seen = before.seenFrom
        if (before.moved === undefined) moved.delete(name)
        else moved.set(name, before.moved)
      })
      return named(entry)
    },

    /** Takes the secret back (unlink): `code` gets a NEW secret, the old one is dead at once. Resolves {kind: 'rotated', secret} or {kind: 'forbidden'}. */
    async rotate(code, secret) {
      const entry = live(code)
      if (!secretOpens(entry, secret)) return { kind: 'forbidden' }
      const before = { h: entry.h, seen: entry.seen }
      const fresh = newSecret()
      entry.h = hashSecret(fresh).toString('hex')
      entry.seen = now()
      await commit(() => Object.assign(entry, before))
      return { kind: 'rotated', secret: fresh }
    },

    /** A RELEASE by the holder: the held name `name`, or the primary when `name` is null (the legacy {"name": ""}). Same result kinds as claim. */
    async release(code, secret, name) {
      const entry = live(code)
      if (!secretOpens(entry, secret)) return { kind: 'forbidden' }
      return change(code, entry, planRelease({ held: namesOf(entry), name, reserved }))
    },

    /** An ADMIN grant (no secret; reserved names allowed). Resolves {kind: 'named', name, aliases}, {kind: 'taken' | 'too_many'} or {kind: 'unknown'} (no such live code). */
    async grant(code, name, alias = false) {
      const entry = live(code)
      if (entry === undefined) return { kind: 'unknown' }
      return change(code, entry, planGrant({ held: namesOf(entry), name, alias, takenByOther: takenByOther(code, name) }))
    },

    /** An ADMIN removal of `name` from `code` (a locked name too). Resolves {kind: 'named', name, aliases}, {kind: 'not_held'} or {kind: 'unknown'}. */
    async remove(code, name) {
      const entry = live(code)
      if (entry === undefined) return { kind: 'unknown' }
      return change(code, entry, planRemove({ held: namesOf(entry), name }))
    },

    /** Every held name of a live code that satisfies `match`, as [{name, code}] in name order. For the operator's list of reserved names; never exposed to the app. */
    holders(match) {
      return [...names].filter(([n, c]) => match(n) && live(c) !== undefined).map(([name, code]) => ({ name, code })).sort((a, b) => (a.name < b.name ? -1 : 1))
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

    /** Did the name `code` claimed have another holder within PREV_MS? (no identity is kept or told) */
    hadPreviousHolder(code) {
      const at = live(code)?.previousHolderAt
      return at !== undefined && at > now() - PREV_MS
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
