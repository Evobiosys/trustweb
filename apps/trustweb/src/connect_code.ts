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
  /** The username this code holds on the server (/who/<name>), when the person claimed one. */
  name?: string
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
}

export type ConnectOutcome = { ok: true; record: ConnectRecord } | { ok: false; error: ConnectError }

/** A stored value, checked: a record with a well-formed code and secret, or null (a corrupted record never throws). */
export function readConnectRecord(raw: unknown): ConnectRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { code, secret, url, updatedAt } = raw as Record<string, unknown>
  if (typeof code !== 'string' || !CONNECT_CODE_RE.test(code)) return null
  if (typeof secret !== 'string' || !CONNECT_SECRET_RE.test(secret)) return null
  if (typeof url !== 'string' || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const name = (raw as Record<string, unknown>).name
  return typeof name === 'string' && NAME_RE.test(name) && !CONNECT_CODE_RE.test(name) ? { code, secret, url, updatedAt, name } : { code, secret, url, updatedAt }
}

/** Boot migration: a connectCode value that is not a good record is dropped. True when the state changed. Never throws. */
export function repairConnectRecord(state: { connectCode?: unknown }): boolean {
  if (state.connectCode === undefined) return false
  if (readConnectRecord(state.connectCode)) return false
  delete state.connectCode
  return true
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
  if (record.url !== longUrl) return true
  return now - record.updatedAt >= CONNECT_REFRESH_MS || now < record.updatedAt
}

/** The short link to show for this long link right now, or null while the server's copy is missing or out of date. */
export function shortToShow(origin: string, record: ConnectRecord | null, longUrl: string, now: number): string | null {
  if (!record || registrationDue(record, longUrl, now)) return null
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

type ClientDepsForClaim = ConnectClientDeps

async function postTo(deps: ConnectClientDeps, path: string, body: string): Promise<{ status: number; json: unknown } | ConnectError.Network> {
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

function field(json: unknown, key: string): unknown {
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
  const res = await post(deps, bodyFor(longUrl, record))
  if (res === ConnectError.Network) return { ok: false, error: ConnectError.Network }
  // Only the server's "forbidden" (unknown, expired, wrong secret) means the code is gone; a 403 forbidden_origin (a proxy or origin
  // problem) must not throw away a code that still works, and with it a printed QR and a username.
  if (record && res.status === 403 && field(res.json, 'error') === 'forbidden') return registerConnect(deps, null, longUrl)
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
  /** 409: somebody else holds it. */
  Taken = 'taken',
  /** 403: the server no longer knows this code (it expired); the next registration makes a new one. */
  Forgotten = 'forgotten',
  RateLimited = 'rate-limited',
  Network = 'network',
  /** 503, 507 or another 5xx. */
  Server = 'server',
}

export type ClaimOutcome = { ok: true; name: string } | { ok: false; error: ClaimError }

/** What the person typed, as the server wants it: no leading "@", lowercase, trimmed. */
export function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/** True for a name this client will send: empty (release) or a valid name that does not look like a code. */
export function isClaimable(name: string): boolean {
  return name === '' || (NAME_RE.test(name) && !CONNECT_CODE_RE.test(name))
}

/** POST /name {name, code, secret}: claims a username for the code, or releases it with "". Never throws. */
export async function claimName(deps: ClientDepsForClaim, record: ConnectRecord, name: string): Promise<ClaimOutcome> {
  if (!canRegister(deps.origin)) return { ok: false, error: ClaimError.Network }
  if (!isClaimable(name)) return { ok: false, error: ClaimError.BadName }
  const res = await postTo(deps, '/name', JSON.stringify({ name, code: record.code, secret: record.secret }))
  if (res === ConnectError.Network) return { ok: false, error: ClaimError.Network }
  if (res.status === 200) return field(res.json, 'name') === name ? { ok: true, name } : { ok: false, error: ClaimError.Server }
  if (res.status === 409) return { ok: false, error: ClaimError.Taken }
  if (res.status === 403) return { ok: false, error: ClaimError.Forgotten }
  if (res.status === 429) return { ok: false, error: ClaimError.RateLimited }
  if (res.status === 400) return { ok: false, error: ClaimError.BadName }
  return { ok: false, error: ClaimError.Server }
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
  /** The username this phone's code holds, or ''. */
  name(): string
  /** Claims a username for this phone's code ('' releases it); the record keeps it on success. */
  claim(name: string): Promise<ClaimOutcome>
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
    const out = await registerConnect(deps, held(), longUrl)
    if (!out.ok) {
      lastFailAt = deps.now()
      if (out.error === ConnectError.RateLimited) cooldownUntil = deps.now() + CONNECT_COOLDOWN_MS
      if (out.error !== ConnectError.NotHere && out.error !== ConnectError.Refused) scheduleRetry()
      return false
    }
    deps.store(out.record)
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
    name: (): string => held()?.name ?? '',
    async claim(name: string): Promise<ClaimOutcome> {
      const record = held()
      if (!record) return { ok: false, error: ClaimError.NoCode }
      const out = await claimName(deps, record, name)
      // POST /name shares the per-address budget of POST /connect: a 429 here also pauses the registration.
      if (!out.ok && out.error === ClaimError.RateLimited) cooldownUntil = deps.now() + CONNECT_COOLDOWN_MS
      if (!out.ok) return out
      const { name: _old, ...rest } = record
      deps.store(out.name ? { ...rest, name: out.name } : rest)
      for (const l of [...listeners]) l()
      return out
    },
  }
}
