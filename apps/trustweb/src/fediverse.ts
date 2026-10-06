/**
 * Mastodon and Pixelfed as SERVICES (wave 1733 round B, item 2; contract I1:
 * no AGPL code, no new dependency, no server of ours in between):
 *   - reading: a person's PUBLIC posts, fetched by this phone straight from
 *     their instance's public Mastodon-compatible API (Pixelfed speaks it
 *     too): GET /api/v1/accounts/lookup?acct=<user>, then
 *     GET /api/v1/accounts/<id>/statuses. No login. Whether an instance lets
 *     this page read it (CORS) is found out when the address is added; where
 *     it does not, the app links out ("Open their profile"). Never proxied
 *     through our server (that would be an open proxy, amendment A1).
 *   - remote HTML becomes plain text (DOMParser + textContent), never markup;
 *     pictures are a second request to their instance, so only where the
 *     person switched pictures on.
 *   - sharing out: https://<instance>/share?text=... for Mastodon; Pixelfed
 *     has no confirmed share-with-text link, so its compose page opens and the
 *     text is on the clipboard to paste. Always the person's own tap.
 * Pure apart from fetch (injectable): the unit tests run it with a fake instance.
 */
import type { FediverseLink, Person } from './model'
import { PostKind } from './feed'
import { stripUnsafe } from './safe_text'
import type { Post } from './feed'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface Handle {
  user: string
  /** host, or host:port (local test instances only). */
  host: string
}

export enum FetchProblem {
  /** Unreachable, or it does not let this page read it (a browser cannot tell the two apart). */
  Unreachable = 'unreachable',
  RateLimited = 'rate-limited',
  NotFound = 'not-found',
  /** It answered, but not as a Mastodon-compatible API. */
  Malformed = 'malformed',
}

/** A public post as the Feed needs it (already plain text). */
export interface RemoteStatus {
  id: string
  at: number
  text: string
  url: string
  imageUrl?: string
  imageAlt?: string
}

const USER_RE = /^[A-Za-z0-9_.-]{1,64}$/
const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
/**
 * Names that never lead to a public instance (this network, this machine, or
 * no public DNS at all): a typed address or a remote link pointing there could
 * make the phone probe its own network (review-app-b).
 */
const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'arpa', 'test', 'invalid', 'example', 'onion']
/** Local test instances (127.0.0.1:<port>), allowed only where the caller says so (the dev build). */
const LOCAL_RE = /^127\.0\.0\.1:\d{2,5}$/
const FETCH_TIMEOUT_MS = 8_000
const STATUSES_LIMIT = 10
const TEXT_MAX = 500
/** An answer bigger than this is not read (a lookup is a few KB, ten statuses some tens of KB). */
export const BODY_MAX_BYTES = 1_000_000
/** Remote HTML longer than this is cut before it is parsed (the text keeps TEXT_MAX characters anyway). */
const HTML_MAX = 20_000

/** A public DNS name (not an address literal, not a reserved name). */
function isPublicHost(host: string): boolean {
  if (!HOST_RE.test(host)) return false
  const labels = host.split('.')
  return !RESERVED_SUFFIXES.includes(labels[labels.length - 1]) && !host.endsWith('.home.arpa')
}


/**
 * "@user@host", "user@host" or a profile link "https://host/@user" -> a handle;
 * anything else is null. `allowLocal` admits 127.0.0.1:<port> (dev and tests only).
 */
export function parseHandle(input: string, allowLocal = false): Handle | null {
  const raw = input.trim()
  let user = ''
  let host = ''
  const link = /^https?:\/\/([^/\s]+)\/@([^/\s?#]+)\/?$/i.exec(raw)
  if (link) { host = link[1]; user = link[2] } else {
    const m = /^@?([^@\s]+)@([^@\s/]+)$/.exec(raw)
    if (!m) return null
    user = m[1]; host = m[2]
  }
  host = host.toLowerCase()
  if (!USER_RE.test(user)) return null
  if (!isPublicHost(host) && !(allowLocal && LOCAL_RE.test(host))) return null
  return { user, host }
}

export const handleText = (h: Handle): string => `${h.user}@${h.host}`

/** https://host, or http:// for a local test instance. */
export function instanceBase(host: string): string {
  return `${LOCAL_RE.test(host) ? 'http' : 'https'}://${host}`
}

export function profileUrl(h: Handle): string {
  return `${instanceBase(h.host)}/@${encodeURIComponent(h.user)}`
}

/** Remote HTML -> plain text: tags dropped, line breaks kept, entities decoded; never inserted as markup. */
export function htmlToText(html: string): string {
  const withBreaks = html.slice(0, HTML_MAX).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
  let text: string
  if (typeof DOMParser !== 'undefined') {
    // Parsed into an inert document (nothing runs, nothing loads); what is not text goes before reading the text.
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
    doc.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove())
    text = doc.body.textContent ?? ''
  } else {
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
    text = withBreaks.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '').replace(/&(#?[a-z0-9]+);/gi, (m, e: string) => entities[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m))
  }
  return stripUnsafe(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_MAX)
}

/** The body as text, refused (null) past BODY_MAX_BYTES, read in chunks so a huge answer is never held whole. */
async function cappedText(res: Response): Promise<string | null> {
  if (Number(res.headers.get('Content-Length') ?? 0) > BODY_MAX_BYTES) return null
  const reader = res.body?.getReader()
  if (!reader) {
    const all = await res.text()
    return all.length > BODY_MAX_BYTES ? null : all
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > BODY_MAX_BYTES) { void reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

async function getJson(url: string, f: FetchFn): Promise<unknown | FetchProblem> {
  let res: Response
  // A plain controller, not AbortSignal.timeout(): that one is missing on iOS before 16.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    // No cookies, no referrer, no redirect to somewhere the person did not type (review-app-b).
    res = await f(url, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: ctl.signal })
  } catch {
    clearTimeout(timer)
    return FetchProblem.Unreachable
  }
  try {
    if (res.status === 429) return FetchProblem.RateLimited
    if (res.status === 404) return FetchProblem.NotFound
    if (!res.ok) return FetchProblem.Unreachable
    const text = await cappedText(res)
    return text === null ? FetchProblem.Malformed : JSON.parse(text) as unknown
  } catch {
    return FetchProblem.Malformed
  } finally {
    // The deadline covers reading the body too: an instance that trickles bytes is cut off.
    clearTimeout(timer)
  }
}

export const isProblem = (v: unknown): v is FetchProblem => typeof v === 'string' && (Object.values(FetchProblem) as string[]).includes(v)

/** The account's id on its instance (the public lookup), or why not. */
export async function lookupAccount(h: Handle, f: FetchFn): Promise<string | FetchProblem> {
  const v = await getJson(`${instanceBase(h.host)}/api/v1/accounts/lookup?acct=${encodeURIComponent(h.user)}`, f)
  if (isProblem(v)) return v
  const id = typeof v === 'object' && v !== null ? (v as Record<string, unknown>).id : undefined
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : FetchProblem.Malformed
}

/**
 * A link or picture address from a remote post: https to a public name only
 * (http to 127.0.0.1 only for the dev build's test instances), never an SVG.
 */
export function safeRemoteUrl(u: unknown, allowLocal = false, image = false): string | undefined {
  if (typeof u !== 'string' || u.length > 2000) return undefined
  let url: URL
  try { url = new URL(u) } catch { return undefined }
  const local = allowLocal && url.protocol === 'http:' && LOCAL_RE.test(url.host)
  if (!local && !(url.protocol === 'https:' && !url.port && isPublicHost(url.hostname) && !url.username && !url.password)) return undefined
  if (image && /\.svgz?$/i.test(url.pathname)) return undefined
  return url.toString()
}

function statusOf(v: unknown, host: string, allowLocal: boolean): RemoteStatus | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.content !== 'string' || typeof o.created_at !== 'string') return null
  if (o.visibility !== undefined && o.visibility !== 'public') return null
  const at = Date.parse(o.created_at)
  if (!Number.isFinite(at)) return null
  const media = Array.isArray(o.media_attachments) ? o.media_attachments.find((m) => typeof m === 'object' && m !== null && (m as Record<string, unknown>).type === 'image') as Record<string, unknown> | undefined : undefined
  const imageUrl = safeRemoteUrl(media?.preview_url, allowLocal, true) ?? safeRemoteUrl(media?.url, allowLocal, true)
  const description = typeof media?.description === 'string' ? stripUnsafe(media.description) : undefined
  const text = htmlToText(o.content) || (description ? description.slice(0, TEXT_MAX) : '')
  return {
    id: o.id.slice(0, 64), at, text, url: safeRemoteUrl(o.url, allowLocal) ?? `${instanceBase(host)}/`,
    ...(imageUrl ? { imageUrl } : {}),
    ...(description ? { imageAlt: description.slice(0, 200) } : {}),
  }
}

/** Their latest public posts (no replies, no boosts), or why not. */
export async function publicStatuses(h: Handle, accountId: string, f: FetchFn, allowLocal = false): Promise<RemoteStatus[] | FetchProblem> {
  const v = await getJson(`${instanceBase(h.host)}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=${STATUSES_LIMIT}&exclude_replies=true&exclude_reblogs=true`, f)
  if (isProblem(v)) return v
  if (!Array.isArray(v)) return FetchProblem.Malformed
  // An instance that ignores ?limit= cannot make the phone parse thousands of posts.
  return v.slice(0, STATUSES_LIMIT).map((x) => statusOf(x, h.host, allowLocal)).filter((x): x is RemoteStatus => x !== null && x.text !== '')
}

/** A person's public posts as Feed posts (pictures only where switched on). */
export function remotePosts(p: Person, link: FediverseLink, statuses: readonly RemoteStatus[], withImages: boolean): Post[] {
  return statuses.map((st) => ({
    id: `remote:${link.handle}:${st.id}`, kind: PostKind.Remote, who: p.name, personId: p.id, at: st.at, text: st.text,
    context: link.handle, dummy: false, ...(withImages && st.imageUrl ? { imageUrl: st.imageUrl } : {}),
    open: { kind: 'url', url: st.url },
  }))
}

/** Where "Share to..." goes, in the order offered: a picture goes to Pixelfed first, text to Mastodon first. */
export enum ShareTarget {
  Mastodon = 'mastodon',
  Pixelfed = 'pixelfed',
}

export function shareOrder(hasImage: boolean): ShareTarget[] {
  return hasImage ? [ShareTarget.Pixelfed, ShareTarget.Mastodon] : [ShareTarget.Mastodon, ShareTarget.Pixelfed]
}

/** Mastodon's own share page (the text prefilled); Pixelfed's compose page (the text has to be pasted). */
export function shareUrlFor(target: ShareTarget, host: string, text: string): string {
  const base = instanceBase(host)
  return target === ShareTarget.Mastodon ? `${base}/share?text=${encodeURIComponent(text)}` : `${base}/i/compose`
}

/** An instance as typed in Settings ("mastodon.social", "https://pixelfed.social/") -> its host, or null. */
export function parseInstance(input: string, allowLocal = false): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return isPublicHost(host) || (allowLocal && LOCAL_RE.test(host)) ? host : null
}
