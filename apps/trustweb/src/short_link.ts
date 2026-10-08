/**
 * Short connect links (wave 5, owner 2026-10-07: "can you shorten the link ... maybe using a relay on the server, offer that
 * as an option but make it possible to show the long link"). The server side is services/trustweb-backup (links.mjs,
 * contract section 9 of DEVLOG/trustweb-wave-1733/services-api-contract.txt): POST /link keeps the long connect url for
 * 30 days and answers {id, expires_at}; GET /l/<id> redirects to it.
 *
 * This module is pure: no DOM, no strings (the view maps a ShortLinkError to words), fetch and clock injected.
 *
 * What may be sent, and only after an explicit tap: a connect url (or a demo-account url) on one of the three app origins,
 * never one that carries a key (a hand-over link's recovery key, a meeting's transcript key) or the notes a Meet code can
 * carry in its fragment: those stay on the phone, the fragment being the part a browser never sends anywhere.
 */
import { SHORTENABLE_FRAGMENT_KEYS } from './demo_account'

/** The only origins that serve /link and /l/<id> (Caddy routes both in these three site blocks). */
export const SHORT_LINK_ORIGINS: readonly string[] = ['https://app.idea2.site', 'https://app.trustintheweb.org', 'https://app.trustweb.one']
/** How long the server keeps a short link (LINK_TTL_DAYS), for the words next to the button. */
export const SHORT_LINK_DAYS = 30
/** The server's body and url cap (LINK_MAX_BYTES). A longer url is not offered rather than refused. */
export const SHORT_LINK_MAX_BYTES = 2048
/** One request waits this long, then the long link stays. */
export const SHORT_LINK_TIMEOUT_MS = 10_000
/** A cached link with less than this left is asked for again (the server hands out a fresh id under 24 h; we stay well clear). */
export const SHORT_LINK_MIN_LEFT_MS = 60 * 60 * 1000

const ID_RE = /^[A-Za-z0-9]{10}$/
const PARAM_CONNECT = 'connect'
const FORBIDDEN_PARAMS: readonly string[] = ['handover', 'share']

/** Why a short link did not come; the long link always stays. */
export enum ShortLinkError {
  /** Another origin (localhost, a preview, a file): the service is not there, nothing is sent. */
  NotHere = 'not-here',
  /** This code carries a key or notes that must not leave the phone. */
  Private = 'private',
  /** The url is longer than the server takes. */
  TooLong = 'too-long',
  /** No answer: offline, blocked, or the 10 seconds ran out. */
  Network = 'network',
  /** 429: too many short links from this address just now. */
  RateLimited = 'rate-limited',
  /** 503: short links are switched off on the server. */
  Off = 'off',
  /** 507: the server holds as many links as it takes. */
  Full = 'full',
  /** Any other 4xx: the server refused this url or this request. */
  Refused = 'refused',
  /** 5xx, or a 2xx that is not a short link. */
  Server = 'server',
}

export interface ShortLink {
  id: string
  /** Epoch ms. */
  expiresAt: number
}

export type ShortOutcome =
  | { ok: true; link: ShortLink; short: string; fromCache: boolean }
  | { ok: false; error: ShortLinkError; retryAfterSeconds?: number }

/** May this page offer short links at all: exactly the three app origins. */
export function canShorten(origin: string): boolean {
  return SHORT_LINK_ORIGINS.includes(origin)
}

/** The request body the server would read, in bytes. */
function bodyBytes(url: string): number {
  return new TextEncoder().encode(JSON.stringify({ url })).length
}

/**
 * Why this url may not be sent, or null when it may. Strict on purpose: a connect url of THIS origin whose fragment holds
 * only the demo-account keys (or nothing). A hand-over or share link, a "k" key, a "#n=" notes fragment, another origin,
 * a url with no connect parameter, or one longer than the server takes is not sent.
 */
export function shareBlock(url: string, origin: string): ShortLinkError | null {
  if (!canShorten(origin)) return ShortLinkError.NotHere
  let u: URL
  try { u = new URL(url) } catch { return ShortLinkError.Refused }
  if (u.origin !== origin || u.username || u.password) return ShortLinkError.NotHere
  if (!u.searchParams.get(PARAM_CONNECT)) return ShortLinkError.Refused
  if (FORBIDDEN_PARAMS.some((p) => u.searchParams.has(p))) return ShortLinkError.Private
  const frag = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash)
  for (const key of frag.keys()) if (!SHORTENABLE_FRAGMENT_KEYS.includes(key)) return ShortLinkError.Private
  if (url.length > SHORT_LINK_MAX_BYTES || bodyBytes(url) > SHORT_LINK_MAX_BYTES) return ShortLinkError.TooLong
  return null
}

/** True when shareBlock finds nothing against it. */
export function isShareable(url: string, origin: string): boolean {
  return shareBlock(url, origin) === null
}

/** The short link of an id on this origin (never APP_URL: the app may live under /trustweb/, /l/ sits at the root). */
export function buildShort(origin: string, id: string): string {
  return `${origin}/l/${id}`
}

/** Retry-After in seconds (the number form the server sends), clamped to 1 s .. 1 h; anything else is unknown. */
export function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (raw == null || !/^\d{1,7}$/.test(raw.trim())) return undefined
  return Math.min(3600, Math.max(1, Number(raw)))
}

/** The failure a status stands for. Statuses below 400 and 2xx never come here. */
export function errorForStatus(status: number): ShortLinkError {
  if (status === 429) return ShortLinkError.RateLimited
  if (status === 503) return ShortLinkError.Off
  if (status === 507) return ShortLinkError.Full
  if (status >= 500) return ShortLinkError.Server
  return ShortLinkError.Refused
}

/** The server's answer, checked: a 10-character id and a finite end in the future (relative to `now`). */
export function readLink(body: unknown, now: number): ShortLink | null {
  if (typeof body !== 'object' || body === null) return null
  const { id, expires_at: expiresAt } = body as { id?: unknown; expires_at?: unknown }
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now) return null
  return { id, expiresAt }
}

/** A cached link is still good while it has more than SHORT_LINK_MIN_LEFT_MS left. */
export function stillGood(link: ShortLink, now: number): boolean {
  return link.expiresAt - now > SHORT_LINK_MIN_LEFT_MS
}

export interface ShortLinkerDeps {
  /** The page's origin (location.origin). */
  origin: string
  fetch: typeof fetch
  now: () => number
  timeoutMs?: number
}

export interface ShortLinker {
  /** One request per call unless this url already has a good link here (or one is in flight for it); never throws. */
  shorten(url: string): Promise<ShortOutcome>
  /** What this session already holds for the url (no request), or null. */
  cached(url: string): { link: ShortLink; short: string } | null
}

/** The per-session maker: remembers the link per long url, shares one request between taps, never remembers a failure. */
export function createShortLinker(deps: ShortLinkerDeps): ShortLinker {
  const links = new Map<string, ShortLink>()
  const inFlight = new Map<string, Promise<ShortOutcome>>()
  const timeoutMs = deps.timeoutMs ?? SHORT_LINK_TIMEOUT_MS

  const held = (url: string): { link: ShortLink; short: string } | null => {
    const link = links.get(url)
    if (!link) return null
    if (!stillGood(link, deps.now())) { links.delete(url); return null }
    return { link, short: buildShort(deps.origin, link.id) }
  }

  const request = async (url: string): Promise<ShortOutcome> => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await deps.fetch(`${deps.origin}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: ctl.signal,
      })
      if (!res.ok) {
        const retry = res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : undefined
        return { ok: false, error: errorForStatus(res.status), ...(retry !== undefined ? { retryAfterSeconds: retry } : {}) }
      }
      const link = readLink(await res.json().catch(() => null), deps.now())
      if (!link) return { ok: false, error: ShortLinkError.Server }
      links.set(url, link)
      return { ok: true, link, short: buildShort(deps.origin, link.id), fromCache: false }
    } catch {
      return { ok: false, error: ShortLinkError.Network }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    cached: held,
    shorten(url: string): Promise<ShortOutcome> {
      const block = shareBlock(url, deps.origin)
      if (block) return Promise.resolve({ ok: false, error: block })
      const have = held(url)
      if (have) return Promise.resolve({ ok: true, ...have, fromCache: true })
      const running = inFlight.get(url)
      if (running) return running
      const call = request(url).finally(() => { inFlight.delete(url) })
      inFlight.set(url, call)
      return call
    },
  }
}
