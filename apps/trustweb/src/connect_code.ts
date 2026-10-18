/**
 * The persistent connect code (wave 6b, owner 2026-10-08: "it should be like a uuid that the relay hosts for it to be short,
 * which should also show on the qr code"). Server side: services/trustweb-backup (connect.mjs, contract section 10 of
 * DEVLOG/trustweb-wave-1733/services-api-contract.txt): POST /connect keeps this phone's long connect link under a code that
 * never changes, GET /c/<code> redirects to it.
 *
 * The phone keeps {code, secret, url, updatedAt} in its record (AppState.connectCode, optional, record stays v:1). It registers
 * once, then UPDATES the stored link when its long link changes (a new name) or after 30 days (so the server's 365 day
 * expiry never runs out for a phone that is used). The secret is a password: it stays in the record, never in a URL, a QR,
 * a log or a message; the record leaves the phone only inside the encrypted backup (backup.ts, the person's own key).
 *
 * Pure of DOM and strings: fetch, clock, timers and the record store are injected. A failed POST never blocks anything: the
 * long link stays on show and the keeper tries again later (a few times, with growing pauses), then at the next ensure().
 */
import { canShorten, shareBlock } from './short_link'

/** Names: 3 to 30 characters of [a-z0-9._-], first and last [a-z0-9] (contract 10.0 with the V1 narrowing); the client lowercases what is typed. */
export const NAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/

/** Exactly what the server mints: 16 random bytes as base64url. */
export const CONNECT_CODE_RE = /^[A-Za-z0-9_-]{22}$/
/** 32 random bytes as base64url (contract 10.0). */
export const CONNECT_SECRET_RE = /^[A-Za-z0-9_-]{43}$/
/** The stored link is sent again after this long even when it did not change. */
export const CONNECT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000
/** One request waits this long, then the long link stays. */
export const CONNECT_TIMEOUT_MS = 10_000
/** After a 429 nothing is sent for at least this long, however often Meet is drawn (the server's budget is 6 POSTs a minute per address). */
export const CONNECT_COOLDOWN_MS = 60_000
/** After any failed registration, a new ensure() (not a retry) waits at least this long: no burst of requests while the server is down. */
export const CONNECT_MIN_GAP_MS = 3_000
/** Pauses before the retries of a failed registration (never under a minute: the server's budget is 6 POSTs a minute per address); after the last one the keeper rests until the next ensure(). */
export const CONNECT_RETRY_MS: readonly number[] = [60_000, 180_000, 600_000]

/** What the phone keeps (AppState.connectCode). */
export interface ConnectRecord {
  code: string
  secret: string
  /** The long link the server holds for this code, without any fragment. */
  url: string
  /** Epoch ms of the last successful mint or update. */
  updatedAt: number
  /** The username this code holds on the server (/who/<name>), when the person claimed one: the PRIMARY name. */
  name?: string
  /** Wave 6e: up to two more names this code holds (aliases); /who/<alias> reaches the same code. Absent: none. */
  aliases?: string[]
  /**
   * Wave 6e: names the app learned are LOCKED (granted by the operator: the server refuses to release or replace them, 409 name_locked).
   * Only names this code still holds are kept. Absent: none known.
   */
  lockedNames?: string[]
  /**
   * Wave 15 (devices; local only, never synced): 'other' = the record came from a linked device. The keeper then does NOTHING with it (never
   * re-points the url, never mints on a 403): the url changes only through the explicit "Open on this device". Absent = 'this'.
   */
  owner?: 'this' | 'other'
  /** Wave 15 (local only): the pairing (sync DID) this record came from; the device name is looked up when drawing. */
  fromDid?: string
  /** Wave 15 (local only): the server refused this record's secret or no longer knows the code (the other device unlinked us, or it expired). */
  stale?: true
  /** Wave 15 (local only): when this device last kept the record alive on the server (a read-only GET /c/<code>). */
  touchedAt?: number
  /** Wave 15 (local only): the code was sent to a linked device, so a dead secret means "sync with it", never a new code. */
  shared?: true
  /** Wave 15: when the secret was last renewed (unlink); separate from `updatedAt` (the url), so each merges by its own clock. Travels. */
  secretAt?: number
  /** Wave 15: in a bundle's otherCodes only: the sender got this entry from yet another device (the receiver cannot name that device). */
  relayed?: true
}

/** A code the keeper must never replace by a new one: it holds a username, was shared with a linked device, or belongs to another device. */
export const mustKeep = (r: ConnectRecord): boolean => r.owner === 'other' || !!r.name || !!r.aliases?.length || r.shared === true

/** A code holds at most this many names: one primary plus up to MAX_ALIASES aliases (services contract 10.9). */
export const MAX_NAMES = 3
export const MAX_ALIASES = MAX_NAMES - 1

function isHeldName(v: unknown): v is string {
  return typeof v === 'string' && NAME_RE.test(v) && !CONNECT_CODE_RE.test(v)
}

/** A stored list of names, checked: valid names only, no duplicates, none of `except`, at most `max`. Never throws. */
export function readNameList(raw: unknown, max: number, except: readonly string[] = []): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) if (isHeldName(v) && !out.includes(v) && !except.includes(v)) out.push(v)
  return out.slice(0, max)
}

/** Why a registration did not happen; the long link always stays. */
export enum ConnectError {
  /** Not an app origin (localhost, a preview): the service is not there, nothing is sent. */
  NotHere = 'not-here',
  /** This link may not be sent (a key or notes in it, or longer than the server takes). */
  Refused = 'refused',
  /** No answer: offline, blocked, or the 10 seconds ran out. */
  Network = 'network',
  /** 429: too many requests from this address just now. */
  RateLimited = 'rate-limited',
  /** 503 or 507: the feature is off, or the server holds as many codes as it takes. */
  Unavailable = 'unavailable',
  /** 5xx, or a 2xx that is not a code. */
  Server = 'server',
  /** Wave 15: the server no longer accepts the secret of a code that holds a username or was shared: it is marked stale, never replaced by a new code. */
  Stale = 'stale',
}

export type ConnectOutcome = { ok: true; record: ConnectRecord } | { ok: false; error: ConnectError }

/** A stored value, checked: a record with a well-formed code and secret, or null (a corrupted record never throws). */
export function readConnectRecord(raw: unknown): ConnectRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { code, secret, url, updatedAt } = raw as Record<string, unknown>
  if (typeof code !== 'string' || !CONNECT_CODE_RE.test(code)) return null
  if (typeof secret !== 'string' || !CONNECT_SECRET_RE.test(secret)) return null
  if (typeof url !== 'string' || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const o = raw as Record<string, unknown>
  const name = isHeldName(o.name) ? o.name : undefined
  const aliases = readNameList(o.aliases, MAX_ALIASES, name ? [name] : [])
  const held = [...(name ? [name] : []), ...aliases]
  const lockedNames = readNameList(o.lockedNames, MAX_NAMES).filter((n) => held.includes(n))
  return {
    code, secret, url, updatedAt,
    ...(o.owner === 'other' ? { owner: 'other' as const } : {}),
    ...(typeof o.fromDid === 'string' && o.fromDid.length <= 1600 ? { fromDid: o.fromDid } : {}),
    ...(o.stale === true ? { stale: true as const } : {}),
    ...(typeof o.touchedAt === 'number' && Number.isFinite(o.touchedAt) ? { touchedAt: o.touchedAt } : {}),
    ...(o.shared === true ? { shared: true as const } : {}),
    ...(typeof o.secretAt === 'number' && Number.isFinite(o.secretAt) ? { secretAt: o.secretAt } : {}),
    ...(o.relayed === true ? { relayed: true as const } : {}),
    ...(name ? { name } : {}), ...(aliases.length ? { aliases } : {}), ...(lockedNames.length ? { lockedNames } : {}),
  }
}

/** Boot migration: a connectCode value that is not a good record is dropped; its name fields are cleaned (valid, unique, at most two aliases). True when the state changed. Never throws. */
export function repairConnectRecord(state: { connectCode?: unknown }): boolean {
  if (state.connectCode === undefined) return false
  const clean = readConnectRecord(state.connectCode)
  if (!clean) {
    delete state.connectCode
    return true
  }
  // A readable record keeps whatever else it holds (a newer build's fields); only its three name fields are made exactly what the reader sees.
  const raw = state.connectCode as Record<string, unknown>
  let changed = false
  for (const key of ['name', 'aliases', 'lockedNames'] as const) {
    if (JSON.stringify(raw[key]) === JSON.stringify(clean[key])) continue
    if (clean[key] === undefined) delete raw[key]
    else raw[key] = clean[key]
    changed = true
  }
  return changed
}

/** The short link of a code on this origin (never APP_URL: the app may live under /trustweb/, /c/ sits at the root). */
export function connectShortLink(origin: string, code: string): string {
  return `${origin}/c/${code}`
}

/** The code inside a short link of this origin, or null. */
export function codeOfShortLink(origin: string, link: string): string | null {
  const prefix = `${origin}/c/`
  if (!link.startsWith(prefix)) return null
  const code = link.slice(prefix.length).split(/[?#]/)[0]
  return CONNECT_CODE_RE.test(code) ? code : null
}

/** May this page register at all: exactly the two app origins. */
export function canRegister(origin: string): boolean {
  return canShorten(origin)
}

/** Does the server's copy need to be written: nothing there yet, another link, or older than 30 days. */
export function registrationDue(record: ConnectRecord | null, longUrl: string, now: number): boolean {
  if (!record) return true
  if (record.owner === 'other' || record.stale) return false // the keeper leaves a record of another device, or one with a dead secret, alone (wave 15)
  if (record.url !== longUrl) return true
  const at = record.touchedAt ?? record.updatedAt // the last write or read-only touch
  return now - at >= CONNECT_REFRESH_MS || now < at
}

/** The short link to show for this long link right now, or null while the server's copy is missing or out of date. */
export function shortToShow(origin: string, record: ConnectRecord | null, longUrl: string, now: number): string | null {
  if (!record || record.stale || registrationDue(record, longUrl, now)) return null
  return connectShortLink(origin, record.code)
}

function errorForStatus(status: number): ConnectError {
  if (status === 429) return ConnectError.RateLimited
  if (status === 503 || status === 507) return ConnectError.Unavailable
  if (status >= 500) return ConnectError.Server
  return ConnectError.Refused
}

export interface ConnectClientDeps {
  /** The page's origin (location.origin). */
  origin: string
  fetch: typeof fetch
  now: () => number
  timeoutMs?: number
}

/** The body the server reads (contract 10.1): url, and code + secret for an update. */
function bodyFor(url: string, record: ConnectRecord | null): string {
  return JSON.stringify(record ? { url, code: record.code, secret: record.secret } : { url })
}

export async function postTo(deps: ConnectClientDeps, path: string, body: string): Promise<{ status: number; json: unknown } | ConnectError.Network> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? CONNECT_TIMEOUT_MS)
  try {
    const res = await deps.fetch(`${deps.origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctl.signal,
    })
    const json: unknown = await res.json().catch(() => null)
    return { status: res.status, json }
  } catch {
    return ConnectError.Network
  } finally {
    clearTimeout(timer)
  }
}

const post = (deps: ConnectClientDeps, body: string): ReturnType<typeof postTo> => postTo(deps, '/connect', body)

export function field(json: unknown, key: string): unknown {
  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[key] : undefined
}

/** A mint answer (201 {code, secret}), checked. */
function mintedRecord(json: unknown, url: string, now: number): ConnectRecord | null {
  const code = field(json, 'code')
  const secret = field(json, 'secret')
  if (typeof code !== 'string' || !CONNECT_CODE_RE.test(code) || typeof secret !== 'string' || !CONNECT_SECRET_RE.test(secret)) return null
  return { code, secret, url, updatedAt: now }
}

/**
 * One registration: mint when the phone holds no code, update when it does. A 403 on an update means the server no longer knows
 * the code (expired, or its file was lost): the phone mints a new one once, so the address works again (the old code is gone).
 * Never throws.
 */
export async function registerConnect(deps: ConnectClientDeps, record: ConnectRecord | null, longUrl: string): Promise<ConnectOutcome> {
  if (!canRegister(deps.origin)) return { ok: false, error: ConnectError.NotHere }
  if (shareBlock(longUrl, deps.origin) !== null) return { ok: false, error: ConnectError.Refused }
  // The same link only aged (F6): a read-only touch, no write; the url is written only when it changed.
  if (record && record.owner !== 'other' && !record.stale && record.url === longUrl) {
    const seen = await touchCode(deps, record.code)
    if (seen === null) return { ok: false, error: ConnectError.Network }
    if (seen) return { ok: true, record: { ...record, touchedAt: deps.now() } }
    return mustKeep(record) ? { ok: false, error: ConnectError.Stale } : registerConnect(deps, null, longUrl)
  }
  const res = await post(deps, bodyFor(longUrl, record))
  if (res === ConnectError.Network) return { ok: false, error: ConnectError.Network }
  // Only the server's "forbidden" (unknown, expired, wrong secret) means the code is gone; a 403 forbidden_origin (a proxy or origin
  // problem) must not throw away a code that still works, and with it a printed QR and a username.
  if (record && res.status === 403 && field(res.json, 'error') === 'forbidden') return mustKeep(record) ? { ok: false, error: ConnectError.Stale } : registerConnect(deps, null, longUrl)
  if (res.status !== 200 && res.status !== 201) return { ok: false, error: errorForStatus(res.status) }
  if (record && res.status === 200) {
    if (field(res.json, 'code') !== record.code) return { ok: false, error: ConnectError.Server }
    return { ok: true, record: { ...record, url: longUrl, updatedAt: deps.now() } }
  }
  const minted = res.status === 201 ? mintedRecord(res.json, longUrl, deps.now()) : null
  return minted ? { ok: true, record: minted } : { ok: false, error: ConnectError.Server }
}

/** Why a username was not claimed (or released). */
export enum ClaimError {
  /** This phone holds no code on the server yet: nothing to attach a name to. */
  NoCode = 'no-code',
  /** Not 3 to 30 letters, digits, dots, dashes or underscores (checked here, before any request). */
  BadName = 'bad-name',
  /** 409 name_taken: somebody else holds it. */
  Taken = 'taken',
  /** 409 reserved: the name stays with the service. */
  Reserved = 'reserved',
  /** 409 name_locked: this code holds the name because the operator granted it; the app can neither release nor replace it. */
  NameLocked = 'name-locked',
  /** 409 too_many_names: the code already holds all three. */
  TooManyNames = 'too-many-names',
  /** 429 name-cap: this network address already claimed its 3 names in 30 days (not the shared cooldown). */
  NameCap = 'name-cap',
  /** 409 alias_cap: moving the name would give the target code more than three names. */
  AliasCap = 'alias-cap',
  /** 409 name_moved: this name moved lately (once in 30 days). */
  NameMoved = 'name-moved',
  /** 409 not_held: the other code no longer holds the name. */
  NotHeld = 'not-held',
  /** 403: the server no longer knows this code (it expired); the next registration makes a new one. */
  Forgotten = 'forgotten',
  RateLimited = 'rate-limited',
  Network = 'network',
  /** 503, 507 or another 5xx. */
  Server = 'server',
}

/** What the person typed, as the server wants it: no leading "@", lowercase, trimmed. */
export function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/** True for a name this client will send: empty (release) or a valid name that does not look like a code. */
export function isClaimable(name: string): boolean {
  return name === '' || (NAME_RE.test(name) && !CONNECT_CODE_RE.test(name))
}

/** A plain GET of /c/<code> (the server's expiry counts from the last open): true = still there, false = gone (404), null = no answer. */
export async function touchCode(deps: ConnectClientDeps, code: string): Promise<boolean | null> {
  try {
    const res = await deps.fetch(`${deps.origin}/c/${code}`, { redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    return res.status !== 404
  } catch { return null }
}

/** A registration answer replaces the stored record, but the names changed while it ran (names_sync.ts) are the fresh ones, not the captured copy. */
function keepNames(next: ConnectRecord, fresh: ConnectRecord | null): ConnectRecord {
  const { name: _n, aliases: _a, lockedNames: _l, ...rest } = next
  if (!fresh || fresh.code !== next.code) return rest
  return {
    ...rest,
    ...(fresh.name ? { name: fresh.name } : {}), ...(fresh.aliases ? { aliases: fresh.aliases } : {}), ...(fresh.lockedNames ? { lockedNames: fresh.lockedNames } : {}),
  }
}

export interface ConnectKeeperDeps extends ConnectClientDeps {
  /** Where the phone keeps the record (AppState.connectCode). */
  load: () => unknown
  store: (record: ConnectRecord) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ConnectKeeper {
  /** Registers or updates the server's copy when due (one request at a time, retries on failure); resolves true when the copy is current. */
  ensure(longUrl: string): Promise<boolean>
  /** The short link to show for this long link now, or null (no code yet, an out-of-date copy, or not an app origin). */
  shortFor(longUrl: string): string | null
  /** Called whenever a registration succeeded. Returns the way to stop listening. */
  onChange(listener: () => void): () => void
  /** Is the cooldown after a 429 still running (names_sync.ts shares the one budget of POST /connect and POST /name)? */
  coolingDown(): boolean
  /** A 429 came back from POST /name: registration pauses too. */
  noteRateLimited(): void
}

/** The per-visit keeper: one request in flight, a bounded retry after a failure, the record kept through deps.store. */
export function createConnectKeeper(deps: ConnectKeeperDeps): ConnectKeeper {
  const listeners = new Set<() => void>()
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>))
  let wanted = ''
  let running: Promise<boolean> | null = null
  let retryHandle: unknown = null
  let attempt = 0
  let cooldownUntil = 0
  let lastFailAt = Number.NEGATIVE_INFINITY

  const held = (): ConnectRecord | null => readConnectRecord(deps.load())
  const stopRetry = (): void => { if (retryHandle !== null) { clearTimer(retryHandle); retryHandle = null } }

  const scheduleRetry = (): void => {
    stopRetry()
    if (attempt >= CONNECT_RETRY_MS.length) return
    const pause = CONNECT_RETRY_MS[attempt]
    attempt += 1
    retryHandle = setTimer(() => { retryHandle = null; void ensure(wanted, true) }, pause)
  }

  const run = async (longUrl: string): Promise<boolean> => {
    const start = held()
    const out = await registerConnect(deps, start, longUrl)
    // A sync may have changed the record while this request ran (another code, a new secret, a url): this answer is then stale and dropped (F7).
    const now = held()
    if (out.ok && (now?.code !== start?.code || now?.secret !== start?.secret || now?.updatedAt !== start?.updatedAt || now?.owner !== start?.owner)) return false
    if (!out.ok && out.error === ConnectError.Stale) {
      if (start && now?.code === start.code) deps.store({ ...now, stale: true })
      for (const l of [...listeners]) l()
      return false
    }
    if (!out.ok) {
      lastFailAt = deps.now()
      if (out.error === ConnectError.RateLimited) cooldownUntil = deps.now() + CONNECT_COOLDOWN_MS
      if (out.error !== ConnectError.NotHere && out.error !== ConnectError.Refused) scheduleRetry()
      return false
    }
    deps.store(keepNames(out.record, held()))
    attempt = 0
    stopRetry()
    for (const l of [...listeners]) l()
    // The link changed while this request ran: that answer was for another link, the caller asks again.
    return !registrationDue(held(), wanted, deps.now())
  }

  const ensure = (longUrl: string, retry = false): Promise<boolean> => {
    wanted = longUrl
    if (!canRegister(deps.origin)) return Promise.resolve(false)
    if (!registrationDue(held(), longUrl, deps.now())) return Promise.resolve(true)
    // A 429 was answered a moment ago: drawing Meet again must not ask again (V1's rule: back off at least a minute).
    if (deps.now() < cooldownUntil) return Promise.resolve(false)
    // A failure a moment ago (server down, offline): redrawing Meet or saving a name does not ask again at once; the retry timer does.
    if (!retry && deps.now() - lastFailAt < CONNECT_MIN_GAP_MS) return Promise.resolve(false)
    if (!retry) attempt = 0
    if (running) return running.then(() => (registrationDue(held(), wanted, deps.now()) ? ensure(wanted, true) : true))
    const call = run(longUrl).finally(() => { running = null })
    running = call
    return call
  }

  return {
    ensure: (longUrl: string): Promise<boolean> => ensure(longUrl),
    shortFor: (longUrl: string): string | null => (canRegister(deps.origin) ? shortToShow(deps.origin, held(), longUrl, deps.now()) : null),
    onChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    coolingDown: (): boolean => deps.now() < cooldownUntil,
    noteRateLimited: (): void => { cooldownUntil = deps.now() + CONNECT_COOLDOWN_MS },
  }
}
