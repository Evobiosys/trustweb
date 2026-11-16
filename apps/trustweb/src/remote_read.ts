// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Review-44 (Jakob: split the shared helpers now, never "later"): the small read helpers of everything that reads a remote post, one copy for
 * fediverse.ts (the Feed's people and tags) and feed_embed.ts (one pasted post link). A leaf with no imports on purpose: apps/mcp loads
 * feed_embed.ts under plain node, which resolves only `.ts` paths, so this file must not pull in anything else.
 *   - safeRemoteUrl: https to a public DNS name only (no address literal, no reserved name, no port, no login); http to 127.0.0.1 only where the
 *     caller allows it (the dev build's test instances); pictures never SVG.
 *   - htmlToText: remote HTML becomes plain text (an inert DOMParser document in the browser, a tag-stripping fallback under node); never markup.
 *   - fetchCapped / getJsonOrProblem: one GET, no cookies, no referrer, no redirect, 8 s for the whole answer, at most 1 MB read in chunks.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** Why a remote read gave nothing (the values of fediverse.ts FetchProblem). */
export type RemoteProblem = 'unreachable' | 'rate-limited' | 'not-found' | 'malformed'
export const REMOTE_PROBLEMS: readonly RemoteProblem[] = ['unreachable', 'rate-limited', 'not-found', 'malformed']
export const isRemoteProblem = (v: unknown): v is RemoteProblem => typeof v === 'string' && (REMOTE_PROBLEMS as readonly string[]).includes(v)

/** An answer bigger than this is not read (a lookup is a few KB, ten statuses some tens of KB). */
export const REMOTE_BODY_MAX = 1_000_000
/** Plain text taken from one remote post. */
export const REMOTE_TEXT_MAX = 500
const FETCH_TIMEOUT_MS = 8_000
/** Remote HTML longer than this is cut before it is parsed (the text keeps REMOTE_TEXT_MAX characters anyway). */
const HTML_MAX = 20_000

const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
/**
 * Names that never lead to a public instance (this network, this machine, or no public DNS at all): a typed address or a remote link pointing
 * there could make the phone probe its own network (review-app-b).
 */
const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'arpa', 'test', 'invalid', 'example', 'onion']
/** Local test instances (127.0.0.1:<port>), allowed only where the caller says so (the dev build). */
export const LOCAL_HOST_RE = /^127\.0\.0\.1:\d{2,5}$/
/** Control characters and bidi overrides (the same set as safe_text.ts stripUnsafe, kept here so this file has no imports). */
const UNSAFE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
export const stripRemoteUnsafe = (t: string): string => t.replace(UNSAFE_RE, '')

/** A public DNS name (not an address literal, not a reserved name). */
export function isPublicHost(host: string): boolean {
  if (!HOST_RE.test(host)) return false
  const labels = host.split('.')
  return !RESERVED_SUFFIXES.includes(labels[labels.length - 1]) && !host.endsWith('.home.arpa')
}

/** A link or picture address from a remote post (see the header), or undefined. */
export function safeRemoteUrl(u: unknown, allowLocal = false, image = false): string | undefined {
  if (typeof u !== 'string' || u.length > 2000) return undefined
  let url: URL
  try { url = new URL(u) } catch { return undefined }
  const local = allowLocal && url.protocol === 'http:' && LOCAL_HOST_RE.test(url.host)
  if (!local && !(url.protocol === 'https:' && !url.port && isPublicHost(url.hostname) && !url.username && !url.password)) return undefined
  if (image && /\.svgz?$/i.test(url.pathname)) return undefined
  return url.toString()
}

/** Remote HTML -> plain text: scripts and styles gone, tags dropped, line breaks kept, entities decoded; never inserted as markup. */
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
    text = withBreaks.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '')
      .replace(/&(#?[a-z0-9]+);/gi, (m, e: string) => entities[e.toLowerCase()] ?? (/^#\d{1,7}$/.test(e) && Number(e.slice(1)) <= 0x10ffff ? String.fromCodePoint(Number(e.slice(1))) : m))
  }
  return stripRemoteUnsafe(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, REMOTE_TEXT_MAX)
}

/** The body as text, refused (null) past REMOTE_BODY_MAX, read in chunks so a huge answer is never held whole. */
async function cappedText(res: Response): Promise<string | null> {
  if (Number(res.headers.get('Content-Length') ?? 0) > REMOTE_BODY_MAX) return null
  const reader = res.body?.getReader()
  if (!reader) {
    const all = await res.text()
    return all.length > REMOTE_BODY_MAX ? null : all
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > REMOTE_BODY_MAX) { void reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

/** One GET (see the header): the body as text, or why not. */
export async function fetchCapped(url: string, f: FetchFn, accept: string): Promise<string | RemoteProblem> {
  let res: Response
  // A plain controller, not AbortSignal.timeout(): that one is missing on iOS before 16.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    // No cookies, no referrer, no redirect to somewhere the person did not type (review-app-b).
    res = await f(url, { headers: { Accept: accept }, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: ctl.signal })
  } catch {
    clearTimeout(timer)
    return 'unreachable'
  }
  try {
    if (res.status === 429) return 'rate-limited'
    if (res.status === 404) return 'not-found'
    if (!res.ok) return 'unreachable'
    const text = await cappedText(res)
    return text === null ? 'malformed' : text
  } catch {
    return 'malformed'
  } finally {
    // The deadline covers reading the body too: an instance that trickles bytes is cut off.
    clearTimeout(timer)
  }
}

/** One GET of JSON: the parsed value, or why not. */
export async function getJsonOrProblem(url: string, f: FetchFn): Promise<unknown> {
  const text = await fetchCapped(url, f, 'application/json')
  if (isRemoteProblem(text)) return text
  try { return JSON.parse(text) as unknown } catch { return 'malformed' }
}
