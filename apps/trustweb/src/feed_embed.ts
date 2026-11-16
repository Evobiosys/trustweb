// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 feed-embed (Jakob β): paste the link of one post and it becomes a post in the Feed. Pure: the fetch is injected, nothing runs on its own.
 * Privacy: one GET to the post's own host (Bluesky: public.api.bsky.app), only after the person pressed "Embed this post"; the answer is read
 * as data (text via htmlToText, picture and link addresses via safeRemoteUrl), never inserted as markup; no remote iframe, script or player is ever
 * built (video = title + thumbnail + link). Anything that fails, and every network without a public read (X, LinkedIn, Pixelfed, other pages),
 * becomes a link card that shows the domain.
 * apps/mcp loads it under plain node, where extension-less imports do not resolve: its one value import is the leaf remote_read.ts, by its `.ts`
 * path (review-44: the read helpers htmlToText, safeRemoteUrl, getJson used to be copies of fediverse.ts here).
 */
import type { Post, PostKind } from './feed'
import { getJsonOrProblem, htmlToText, isRemoteProblem, REMOTE_TEXT_MAX as TEXT_MAX, safeRemoteUrl, stripRemoteUnsafe as stripUnsafe } from './remote_read.ts'
import type { FetchFn } from './remote_read.ts'

export type Network = 'mastodon' | 'pixelfed' | 'peertube' | 'bluesky' | 'vimeo' | 'x' | 'linkedin' | 'other'

export interface PostLink {
  network: Network
  host: string
  url: string
  /** Mastodon, Pixelfed, PeerTube, Vimeo: the post or video id. */
  id?: string
  /** Bluesky: the handle or did in the link, and the post key. */
  handle?: string
  rkey?: string
}

/** What the record keeps of an embedded post (AppState.feedEmbeds); `card`: only the link could be shown. */
export interface EmbedRecord {
  id: string
  who: string
  handle?: string
  at: number
  text: string
  imageUrl?: string
  url: string
  linkHost: string
  card?: true
}

/** At most this many embeds are kept, newest first. */
export const EMBED_MAX = 200
const BSKY_API = 'https://public.api.bsky.app/xrpc'

/** One GET as JSON, null on any problem (remote_read.ts: no cookies, no referrer, no redirect, 8 s, 1 MB). */
const getJson = async (url: string, f: FetchFn): Promise<unknown> => {
  const v = await getJsonOrProblem(url, f)
  return isRemoteProblem(v) ? null : v
}

const rules: { network: Network; re: RegExp }[] = [
  { network: 'mastodon', re: /^\/@[^/@]+(?:@[^/]+)?\/(\d+)\/?$/ },
  { network: 'mastodon', re: /^\/users\/[^/]+\/statuses\/(\d+)\/?$/ },
  { network: 'pixelfed', re: /^\/p\/[^/]+\/(\d+)\/?$/ },
  { network: 'pixelfed', re: /^\/i\/web\/post\/(\d+)\/?$/ },
  { network: 'peertube', re: /^\/w\/([\w-]+)\/?$/ },
  { network: 'peertube', re: /^\/videos\/watch\/([\w-]+)\/?$/ },
]

/** One https link (public host, no login, no port) -> where it points; anything else is null. */
export function parsePostLink(input: string): PostLink | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw) || !safeRemoteUrl(raw)) return null
  const u = new URL(raw)
  const host = u.host
  const url = u.toString()
  const bare = host.replace(/^(www|mobile)\./, '')
  if (bare === 'bsky.app') {
    const m = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)\/?$/.exec(u.pathname)
    if (m) return { network: 'bluesky', host, url, handle: decodeURIComponent(m[1]), rkey: m[2] }
  }
  if (bare === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /^\/(?:video\/)?(\d+)\/?$/.exec(u.pathname)
    if (m) return { network: 'vimeo', host: 'vimeo.com', url, id: m[1] }
  }
  if (/^(x|twitter)\.com$/.test(bare)) return { network: 'x', host, url }
  if (/(^|\.)linkedin\.com$/.test(host)) return { network: 'linkedin', host, url }
  for (const r of rules) {
    const m = r.re.exec(u.pathname)
    if (m) return { network: r.network, host, url, id: m[1] }
  }
  return { network: 'other', host, url }
}

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined)
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? stripUnsafe(v).trim().slice(0, max) : '')
const time = (v: unknown, now: number): number => { const t = typeof v === 'string' ? Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z') : NaN; return Number.isFinite(t) ? t : now }

const recordOf = (link: PostLink, now: number, r: Partial<EmbedRecord> & { who: string; text: string }): EmbedRecord => ({
  id: `embed:${link.url}`, at: now, url: link.url, linkHost: link.host, ...r,
})
const cardOf = (link: PostLink, now: number): EmbedRecord => recordOf(link, now, { who: link.host, text: link.url, card: true })

async function mastodon(link: PostLink, f: FetchFn, now: number): Promise<EmbedRecord | null> {
  const v = obj(await getJson(`https://${link.host}/api/v1/statuses/${link.id}`, f))
  const a = obj(v?.account)
  if (!v || !a || typeof v.content !== 'string' || (v.visibility !== undefined && v.visibility !== 'public' && v.visibility !== 'unlisted')) return null
  const media = Array.isArray(v.media_attachments) ? v.media_attachments.map(obj).find((m) => m?.type === 'image') : undefined
  const text = htmlToText(v.content) || str(media?.description, TEXT_MAX)
  const user = str(a.username, 100) || str(a.acct, 100).split('@')[0]
  if (!text || !user) return null
  const acct = str(a.acct, 200)
  const imageUrl = safeRemoteUrl(media?.preview_url, false, true) ?? safeRemoteUrl(media?.url, false, true)
  return recordOf(link, now, {
    who: str(a.display_name, 100) || user, handle: '@' + (acct.includes('@') ? acct : `${acct || user}@${link.host}`), text, at: time(v.created_at, now),
    url: safeRemoteUrl(v.url) ?? link.url, ...(imageUrl ? { imageUrl } : {}),
  })
}

async function bluesky(link: PostLink, f: FetchFn, now: number): Promise<EmbedRecord | null> {
  let did = link.handle ?? ''
  if (!did.startsWith('did:')) {
    const r = obj(await getJson(`${BSKY_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`, f))
    did = str(r?.did, 200)
    if (!did.startsWith('did:')) return null
  }
  const uri = `at://${did}/app.bsky.feed.post/${link.rkey}`
  const thread = obj(await getJson(`${BSKY_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`, f))
  const post = obj(obj(thread?.thread)?.post)
  const author = obj(post?.author)
  const rec = obj(post?.record)
  const text = str(rec?.text, TEXT_MAX)
  const handle = str(author?.handle, 200)
  if (!text || !handle) return null
  const embed = obj(post?.embed)
  const image = Array.isArray(embed?.images) ? obj(embed.images[0]) : obj(embed?.external)
  const imageUrl = safeRemoteUrl(image?.thumb, false, true)
  return recordOf(link, now, { who: str(author?.displayName, 100) || handle, handle: '@' + handle, text, at: time(rec?.createdAt, now), ...(imageUrl ? { imageUrl } : {}) })
}

/** The oEmbed JSON of a video: title + thumbnail + author only; its `html` player is never read. */
async function oembed(link: PostLink, f: FetchFn, now: number): Promise<EmbedRecord | null> {
  const api = link.network === 'vimeo' ? 'https://vimeo.com/api/oembed.json?url=' : `https://${link.host}/services/oembed?format=json&url=`
  const v = obj(await getJson(api + encodeURIComponent(link.url), f))
  const title = str(v?.title, 300)
  if (!title) return null
  const imageUrl = safeRemoteUrl(v?.thumbnail_url, false, true)
  return recordOf(link, now, { who: str(v?.author_name, 100) || link.host, text: title, at: time(v?.upload_date, now), ...(imageUrl ? { imageUrl } : {}) })
}

/** The post behind a link, or a link card with the domain when there is none to read (see the header). `now` stands in where a network gives no date. */
export async function fetchEmbed(link: PostLink, f: FetchFn, now: number = Date.now()): Promise<EmbedRecord> {
  const read = link.network === 'mastodon' ? mastodon : link.network === 'bluesky' ? bluesky : link.network === 'peertube' || link.network === 'vimeo' ? oembed : null
  if (!read) return cardOf(link, now)
  try { return (await read(link, f, now)) ?? cardOf(link, now) } catch { return cardOf(link, now) }
}

/** Keeps an embed (newest first, no repeat, at most EMBED_MAX); false when it was there already. */
export function addEmbed(s: { feedEmbeds?: EmbedRecord[] }, e: EmbedRecord): boolean {
  if (s.feedEmbeds?.some((x) => x.id === e.id)) return false
  s.feedEmbeds = [e, ...(s.feedEmbeds ?? [])].slice(0, EMBED_MAX)
  return true
}

/** The embeds as Feed posts: Remote, so they sit under the fediverse chip; a picture only where pictures are switched on. */
export const embedPosts = (list: readonly EmbedRecord[] | undefined, withImages: boolean): Post[] => (list ?? []).map((e) => ({
  id: e.id, kind: 'remote' as PostKind, who: e.who, at: e.at, text: e.text, context: e.handle ?? e.linkHost, dummy: false,
  ...(e.handle ? { handle: e.handle } : {}), linkHost: e.linkHost, ...(withImages && e.imageUrl ? { imageUrl: e.imageUrl } : {}),
  open: { kind: 'url', url: e.url },
}))
