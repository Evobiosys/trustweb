// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob ι + κ): accounts followed on Bluesky, PeerTube, Threads and through Bridgy Fed (FeedSettings.extFollows), how
 * each is read, when, and its posts as Feed posts. Pure apart from the injected fetch in readExt; nothing runs on its own.
 * Read: Bluesky, Threads and Bridgy accounts through Bluesky's public AppView (feed_bluesky.ts; Threads has no public read, its Bridgy
 * account on Bluesky does), PeerTube through its instance (feed_peertube.ts). Only when the Feed opens or the person presses Refresh, at most
 * once per EXT_TTL_MS, and after a rate limit not before RATE_BACKOFF_MS (not even on Refresh). The view skips every read under
 * "Never read public content" (feed_sources_page.ts publicReadAllowed) and for a source that is off.
 * Posts are kind 'follow' with `src` = the network they come from, so the Sources page's filters, the trusted-only rule (a follow that
 * belongs to a person counts as trusted only when that person is) and the per-source ranking weight apply unchanged.
 * apps/mcp loads it under plain node: value imports by their `.ts` path, no model.ts / feed.ts at runtime.
 */
import { bridgedOnBluesky, bridgyFromBluesky, bridgyFromWebsite, bskyHandle, threadsHandle, websiteOnBluesky } from './ext/bridges/bridges_model.ts'
import { fetchAuthorFeed } from './feed_bluesky.ts'
import { fetchAccountVideos } from './feed_peertube.ts'
import { setSource } from './feed_sources_page.ts'
import type { FeedCfg } from './feed_sources_page.ts'
import { isPublicHost, LOCAL_HOST_RE } from './remote_read.ts'
import type { FetchFn, RemoteProblem } from './remote_read.ts'
import type { Post, PostKind } from './feed'

export type ExtKind = 'bluesky' | 'peertube' | 'threads' | 'bridgy'
export const EXT_KINDS: readonly ExtKind[] = ['bluesky', 'peertube', 'threads', 'bridgy']

/** One followed account: `handle` in its canonical form (bluesky: "alice.bsky.social"; peertube: "name@host"; threads and bridgy: "@user@host"). */
export interface ExtFollow { kind: ExtKind; handle: string; /** The person it belongs to (added on their card): the trusted-only rule asks about them. */ personId?: string }
export type ExtCfg = FeedCfg & { extFollows?: ExtFollow[] }

/** A post as a reader returns it: plain text, public https links only. */
export interface ExtItem {
  id: string
  at: number
  text: string
  url: string
  who: string
  handle?: string
  /** A link card: the linked page's address and title (text, never fetched). */
  card?: { url: string; title: string }
  /** A picture or video thumbnail; loaded only where pictures are switched on. */
  imageUrl?: string
  repostBy?: string
  video?: true
}

/** A source is read again after this long when the Feed opens (Refresh skips it). */
export const EXT_TTL_MS = 5 * 60_000
/** After a 429 nobody asks that source again for this long. */
export const RATE_BACKOFF_MS = 15 * 60_000

const PT_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/
const BSKY_BRIDGED_RE = /^@([^@]+)@bsky\.brid\.gy$/
const WEB_BRIDGED_RE = /^@([^@]+)@web\.brid\.gy$/

function peertubeHandle(input: string, allowLocal: boolean): string | null {
  const raw = input.trim()
  const link = /^https?:\/\/([^/\s]+)\/(?:a|accounts)\/([^/?#\s]+)(?:\/[^\s]*)?$/.exec(raw)
  const acct = /^@?([^@\s]+)@([^@\s/]+)$/.exec(raw)
  const [name, host] = link ? [link[2], link[1].toLowerCase()] : acct ? [acct[1], acct[2].toLowerCase()] : ['', '']
  if (!PT_NAME_RE.test(name)) return null
  return isPublicHost(host) || (allowLocal && LOCAL_HOST_RE.test(host)) ? `${name}@${host}` : null
}

/** A typed address for one kind -> its canonical follow; null when it is none. Bridgy: an http(s) link is a web site, anything else a Bluesky handle. */
export function parseExtFollow(kind: string, input: string, allowLocal = false): ExtFollow | null {
  const raw = input.trim()
  let handle: string | null = null
  if (kind === 'bluesky') handle = bskyHandle(raw)
  else if (kind === 'peertube') handle = peertubeHandle(raw, allowLocal)
  else if (kind === 'threads') handle = threadsHandle(raw)
  else if (kind === 'bridgy') {
    const lower = raw.toLowerCase()
    const done = BSKY_BRIDGED_RE.exec(lower) ?? WEB_BRIDGED_RE.exec(lower)
    handle = done ? (BSKY_BRIDGED_RE.test(lower) ? bridgyFromBluesky(done[1]) : bridgyFromWebsite(done[1])) : /^https?:\/\//.test(lower) ? bridgyFromWebsite(raw) : bridgyFromBluesky(raw)
  } else return null
  return handle ? { kind, handle } : null
}

export const extKey = (f: Pick<ExtFollow, 'kind' | 'handle'>): string => `${f.kind}:${f.handle}`

/** The source id (feed_sources_page.ts SOURCES) a follow's posts filter and rank under: the network they come from. */
export function extSourceId(f: Pick<ExtFollow, 'kind' | 'handle'>): string {
  if (f.kind === 'bridgy') return WEB_BRIDGED_RE.test(f.handle) ? 'rss' : 'bluesky'
  return f.kind
}

/** Adds a follow once and switches its source on (following is the explicit wish to read it); false when it was there already. */
export function addExtFollow(f: ExtCfg, follow: ExtFollow): boolean {
  if ((f.extFollows ?? []).some((x) => extKey(x) === extKey(follow))) return false
  f.extFollows = [...(f.extFollows ?? []), { kind: follow.kind, handle: follow.handle, ...(follow.personId ? { personId: follow.personId } : {}) }]
  setSource(f, extSourceId(follow), { on: true })
  return true
}

export function removeExtFollow(f: ExtCfg, key: string): boolean {
  const before = f.extFollows ?? []
  const after = before.filter((x) => extKey(x) !== key)
  if (after.length === before.length) return false
  if (after.length) f.extFollows = after; else delete f.extFollows
  return true
}

export type ReadPlan = { via: 'bluesky'; actor: string } | { via: 'peertube'; host: string; name: string }

export function readPlan(f: Pick<ExtFollow, 'kind' | 'handle'>): ReadPlan {
  if (f.kind === 'peertube') { const at = f.handle.lastIndexOf('@'); return { via: 'peertube', host: f.handle.slice(at + 1), name: f.handle.slice(0, at) } }
  if (f.kind === 'threads') return { via: 'bluesky', actor: bridgedOnBluesky(f.handle) ?? '' }
  if (f.kind === 'bridgy') {
    const web = WEB_BRIDGED_RE.exec(f.handle)
    return { via: 'bluesky', actor: web ? websiteOnBluesky(web[1]) : BSKY_BRIDGED_RE.exec(f.handle)?.[1] ?? '' }
  }
  return { via: 'bluesky', actor: f.handle }
}

/** Whether a source may be read now: never read, or older than EXT_TTL_MS (an explicit refresh skips that); never inside a rate-limit backoff. */
export function due(got: { at: number; problem?: RemoteProblem } | undefined, now: number, explicit: boolean): boolean {
  if (!got) return true
  if (got.problem === 'rate-limited') return now - got.at > RATE_BACKOFF_MS
  return explicit || now - got.at > EXT_TTL_MS
}

/** One read of one follow through its reader: its latest posts, or why not. */
export async function readExt(f: Pick<ExtFollow, 'kind' | 'handle'>, fetchFn: FetchFn, allowLocal = false): Promise<ExtItem[] | RemoteProblem> {
  const plan = readPlan(f)
  const got = plan.via === 'peertube' ? await fetchAccountVideos(plan.host, plan.name, fetchFn, 0, allowLocal) : await fetchAuthorFeed(plan.actor, fetchFn)
  return typeof got === 'string' ? got : got.items
}

const hostOf = (url: string): string => { try { return new URL(url).hostname } catch { return '' } }

/** A follow's items as Feed posts; a link card stays text (title + address); pictures only where switched on. */
export function extPosts(f: ExtFollow, items: readonly ExtItem[], withImages: boolean): Post[] {
  return items.map((i): Post => ({
    id: `ext:${extKey(f)}:${i.id}`, kind: 'follow' as PostKind, src: extSourceId(f), who: i.who, at: i.at, dummy: false,
    text: i.card ? `${i.text}\n${i.card.title} ${i.card.url}` : i.text,
    context: i.handle ?? f.handle,
    ...(f.personId ? { personId: f.personId } : {}),
    ...(i.handle ? { handle: i.handle } : {}),
    ...(i.repostBy ? { boostedBy: i.repostBy } : {}),
    ...(i.card ? { linkHost: hostOf(i.card.url) } : {}),
    ...(withImages && i.imageUrl ? { imageUrl: i.imageUrl } : {}),
    open: { kind: 'url', url: i.url },
  }))
}

/** Several follows' items as Feed posts; a post reached through two follows (an account and its Bridgy Fed twin) shows once, under the first. */
export function extFeedPosts(entries: readonly { follow: ExtFollow; items: readonly ExtItem[] }[], withImages: boolean): Post[] {
  const seen = new Set<string>()
  return entries.flatMap(({ follow, items }) => extPosts(follow, items.filter((i) => !seen.has(i.id) && seen.add(i.id)), withImages))
}
