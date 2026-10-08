/**
 * "Their TrustWeb code, name or DID" on the add-someone sheet (wave 6b, owner 2026-10-08): one optional field that takes
 * a connect code, a username, a DID, or a pasted connect link, and turns it into the ordinary connect flow.
 *
 * Pure of DOM and strings: fetch and the clock are injected, the view maps a ResolveError / ParseError to words.
 *
 * The parser order is pinned (wave6b_common.txt): "@x" is a name; a 22 character code (or a /c/<code> url) is a code; "did:peer:" is a
 * DID; a url with ?connect= is a long link; anything else is tried as a name; else an error that says what was expected.
 *
 * SECURITY (P9). Nothing is fetched until the person presses the button. A resolver only ever asks THIS app's own origin (/c/<code>
 * or /who/<name>), follows the redirect, and accepts the result only when the final url is one of the two app origins (or this page's own
 * origin, for a local build) in the ?connect= shape that the existing parser reads. A pasted https url on any other host is rejected
 * at parse time and never fetched. A DID connects over the relay only: no server is asked for it.
 */
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import type { ConnectLinkParams } from '../../demo/src/connect_link'
import { resolveDidPeer } from '../../demo/src/did'
import { CONNECT_CODE_RE, NAME_RE } from './connect_code'
import { fingerprint, stripUnsafe } from './safe_text'
import { SHORT_LINK_ORIGINS } from './short_link'

export { NAME_RE }
/** One lookup waits this long. */
export const RESOLVE_TIMEOUT_MS = 10_000
/** A pasted value longer than this is not read (a DID with a service block is a few hundred characters). */
export const ADD_INPUT_MAX = 2048

export enum AddKind {
  Name = 'name',
  Code = 'code',
  Did = 'did',
  LongLink = 'long-link',
}

/** What the field could not be read as. The view words each one. */
export enum ParseError {
  Empty = 'empty',
  TooLong = 'too-long',
  /** A url on a host that is not one of ours (never fetched). */
  OtherHost = 'other-host',
  /** A url of ours that holds no connect link, code or name. */
  NotAConnectLink = 'not-a-connect-link',
  /** "@x" or a bare word that is not a valid name. */
  BadName = 'bad-name',
  /** A did:peer: value that is not a readable did:peer:2. */
  BadDid = 'bad-did',
  /** The code, name or DID of this very phone. */
  Own = 'own',
  /** Anything else. */
  Unreadable = 'unreadable',
}

export type Parsed =
  | { ok: true; kind: AddKind.Name; name: string }
  | { ok: true; kind: AddKind.Code; code: string }
  | { ok: true; kind: AddKind.Did; did: string }
  | { ok: true; kind: AddKind.LongLink; link: ConnectLinkParams }
  | { ok: false; error: ParseError }

const fail = (error: ParseError): Parsed => ({ ok: false, error })

/** The origins whose urls are read at all: the two app origins, and this page's own (a local or preview build). */
function ownOrigins(origin: string): string[] {
  return [...SHORT_LINK_ORIGINS, origin]
}

function nameOf(raw: string): Parsed {
  const name = raw.replace(/^@/, '').trim().toLowerCase()
  if (!NAME_RE.test(name) || CONNECT_CODE_RE.test(name)) return fail(ParseError.BadName)
  return { ok: true, kind: AddKind.Name, name }
}

function didOf(raw: string): Parsed {
  try {
    resolveDidPeer(raw)
  } catch {
    return fail(ParseError.BadDid)
  }
  return { ok: true, kind: AddKind.Did, did: raw }
}

function fromUrl(u: URL, origin: string): Parsed {
  if (u.protocol !== 'https:' && u.origin !== origin) return fail(ParseError.OtherHost)
  if (!ownOrigins(origin).includes(u.origin) || u.username || u.password) return fail(ParseError.OtherHost)
  const code = /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname)?.[1]
  if (code !== undefined) return CONNECT_CODE_RE.test(code) ? { ok: true, kind: AddKind.Code, code } : fail(ParseError.NotAConnectLink)
  const who = /^\/who\/([^/]+)\/?$/.exec(u.pathname)?.[1]
  if (who !== undefined) {
    let decoded = who
    try { decoded = decodeURIComponent(who) } catch { return fail(ParseError.BadName) }
    return nameOf(decoded)
  }
  const link = parseConnectLinkParams(u.search)
  return link ? { ok: true, kind: AddKind.LongLink, link } : fail(ParseError.NotAConnectLink)
}

/** Reads what was typed or pasted into the field. Never throws, never fetches. */
export function parseAddInput(input: string, origin: string): Parsed {
  const raw = stripUnsafe(typeof input === 'string' ? input : '').trim()
  if (!raw) return fail(ParseError.Empty)
  if (raw.length > ADD_INPUT_MAX) return fail(ParseError.TooLong)
  if (raw.startsWith('@')) return nameOf(raw)
  if (CONNECT_CODE_RE.test(raw)) return { ok: true, kind: AddKind.Code, code: raw }
  if (raw.startsWith('did:peer:')) return didOf(raw)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(raw)) {
    let u: URL
    try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return fail(ParseError.Unreadable) }
    return fromUrl(u, origin)
  }
  return nameOf(raw)
}

// ---------------------------------------------------------------------------
// resolving a code or a name through our server (a GET, only on the button)
// ---------------------------------------------------------------------------

/** Why a lookup did not give a connect link. */
export enum ResolveError {
  /** The server does not know it (404): a wrong code or name, or one that expired. */
  NotFound = 'not-found',
  /** 429. */
  RateLimited = 'rate-limited',
  /** No answer: offline, blocked, the redirect left this origin, or the 10 seconds ran out. */
  Network = 'network',
  /** The server answered with something that is not a connect link of ours. */
  Refused = 'refused',
  /** Any other failure of the server. */
  Server = 'server',
}

export type ResolveOutcome = { ok: true; link: ConnectLinkParams } | { ok: false; error: ResolveError }

export interface ResolveDeps {
  /** The page's origin (location.origin): the only host ever asked. */
  origin: string
  fetch: typeof fetch
  timeoutMs?: number
}

/** The connect link at the end of a followed redirect, checked again here: our origins only, the ?connect= shape only. */
export function linkFromFinalUrl(finalUrl: string, origin: string): ConnectLinkParams | null {
  let u: URL
  try { u = new URL(finalUrl) } catch { return null }
  if (!ownOrigins(origin).includes(u.origin) || u.username || u.password) return null
  return parseConnectLinkParams(u.search)
}

async function lookup(deps: ResolveDeps, path: string): Promise<ResolveOutcome> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? RESOLVE_TIMEOUT_MS)
  try {
    const res = await deps.fetch(`${deps.origin}${path}`, {
      method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
    })
    // The answer is only a place to land: the body (the app page) is not read.
    const finalUrl = res.url
    ctl.abort()
    if (res.status === 404) return { ok: false, error: ResolveError.NotFound }
    if (res.status === 429) return { ok: false, error: ResolveError.RateLimited }
    if (res.status >= 500) return { ok: false, error: ResolveError.Server }
    if (!res.ok || !res.redirected) return { ok: false, error: ResolveError.Refused }
    const link = linkFromFinalUrl(finalUrl, deps.origin)
    return link ? { ok: true, link } : { ok: false, error: ResolveError.Refused }
  } catch {
    return { ok: false, error: ResolveError.Network }
  } finally {
    clearTimeout(timer)
  }
}

/** GET /c/<code> on our own origin, following the 302 to the stored connect link. */
export function resolveCode(deps: ResolveDeps, code: string): Promise<ResolveOutcome> {
  if (!CONNECT_CODE_RE.test(code)) return Promise.resolve({ ok: false, error: ResolveError.NotFound })
  return lookup(deps, `/c/${code}`)
}

/** GET /who/<name> on our own origin: the 302 to /c/<code>, then to the stored connect link. */
export function resolveName(deps: ResolveDeps, name: string): Promise<ResolveOutcome> {
  if (!NAME_RE.test(name) || CONNECT_CODE_RE.test(name)) return Promise.resolve({ ok: false, error: ResolveError.NotFound })
  return lookup(deps, `/who/${encodeURIComponent(name)}`)
}

// ---------------------------------------------------------------------------
// a bare DID: no server, the relay only
// ---------------------------------------------------------------------------

/** Why a DID alone cannot be connected from this page. */
export enum DidProblem {
  /** The DID names a relay other than the one this app is served from; the app can only reach its own. */
  OtherRelay = 'other-relay',
  BadDid = 'bad-did',
}

export type DidReadiness = { ok: true; relayOrigin: string } | { ok: false; problem: DidProblem; relayOrigin?: string }

/**
 * Can this page connect to this DID? The relay of a page is its own origin (relay.ts resolveRelayOrigin), whatever a DID's service
 * block says, so a DID is reachable only when that block names this same origin.
 */
export function didReadiness(did: string, origin: string): DidReadiness {
  try {
    const endpoint = new URL(resolveDidPeer(did).serviceEndpoint)
    return endpoint.origin === origin ? { ok: true, relayOrigin: endpoint.origin } : { ok: false, problem: DidProblem.OtherRelay, relayOrigin: endpoint.origin }
  } catch {
    return { ok: false, problem: DidProblem.BadDid }
  }
}

/**
 * The connect params for a bare DID. There is no id and no name in a DID: the id only keys this phone's own record of the person (the
 * wire routes by DID), so a stable one is made from the DID; the name stays empty until the other phone tells it (hello.ts) or the person types one.
 */
export function paramsForDid(did: string): ConnectLinkParams {
  const id = 'd' + fingerprint(did) + fingerprint([...did].reverse().join(''))
  return { did, from: { id, displayName: '' } }
}

// ---------------------------------------------------------------------------
// the whole field: text in, connect params out
// ---------------------------------------------------------------------------

export type AddFailure =
  | { type: 'parse'; error: ParseError }
  | { type: 'resolve'; error: ResolveError; kind: AddKind.Code | AddKind.Name }
  | { type: 'did'; problem: DidProblem; relayOrigin?: string }

export type AddResolved = { ok: true; kind: AddKind; link: ConnectLinkParams } | { ok: false; failure: AddFailure }

/**
 * What the sheet does when "Add to my web" is pressed with the field filled: read it, and for a code or a name ask our server (the only
 * request, and only now); a DID and a pasted link need no server at all. Never throws.
 */
export async function resolveAddInput(deps: ResolveDeps, input: string): Promise<AddResolved> {
  const parsed = parseAddInput(input, deps.origin)
  if (!parsed.ok) return { ok: false, failure: { type: 'parse', error: parsed.error } }
  switch (parsed.kind) {
    case AddKind.LongLink:
      return reachable(parsed.kind, parsed.link, deps.origin)
    case AddKind.Did:
      return reachable(parsed.kind, paramsForDid(parsed.did), deps.origin)
    case AddKind.Code:
    case AddKind.Name: {
      const out = parsed.kind === AddKind.Code ? await resolveCode(deps, parsed.code) : await resolveName(deps, parsed.name)
      return out.ok ? reachable(parsed.kind, out.link, deps.origin) : { ok: false, failure: { type: 'resolve', error: out.error, kind: parsed.kind } }
    }
  }
}

/**
 * Whatever the field turned into, the connection runs over THIS page's relay: a link or DID that names another relay (the other app host)
 * would give a card that says "connected" and never answers, so it is stopped here with the reason.
 */
function reachable(kind: AddKind, link: ConnectLinkParams, origin: string): AddResolved {
  const ready = didReadiness(link.did, origin)
  if (ready.ok) return { ok: true, kind, link }
  return { ok: false, failure: { type: 'did', problem: ready.problem, ...(ready.relayOrigin ? { relayOrigin: ready.relayOrigin } : {}) } }
}
