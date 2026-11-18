// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob κ): the public Bluesky reader. Bluesky's public AppView (public.api.bsky.app, no login, CORS open) serves an
 * account's posts (getAuthorFeed, paged by cursor) and one post's thread (getPostThread). Pure apart from the injected fetch: every read is one
 * GET through remote_read.ts (no cookies, no referrer, no redirect, 8 s, 1 MB). Text and link cards only: no remote markup, no player, no
 * tracking pixel (a picture address is kept and loaded only where the person switched pictures on). An author who asked Bluesky not to be shown
 * to logged-out readers (label `!no-unauthenticated`) is never shown. A 429 comes back as 'rate-limited' (feed_ext_sources.ts waits before asking again).
 * apps/mcp loads it under plain node: value imports by their `.ts` path.
 */
import { getJsonOrProblem, isRemoteProblem, REMOTE_TEXT_MAX, safeRemoteUrl, stripRemoteUnsafe } from './remote_read.ts'
import type { FetchFn, RemoteProblem } from './remote_read.ts'
import type { ExtItem } from './feed_ext_sources.ts'

export const BSKY_API = 'https://public.api.bsky.app/xrpc'
/** Posts per read (the API allows 1 to 100). */
export const BSKY_PAGE = 20
const ACTOR_RE = /^(did:(plc|web):[a-z0-9.:-]{4,253}|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/
const URI_RE = /^at:\/\/did:[a-z]+:[A-Za-z0-9.:-]+\/app\.bsky\.feed\.post\/[A-Za-z0-9]+$/

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : undefined)
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? stripRemoteUnsafe(v).trim().slice(0, max) : '')

export function authorFeedUrl(actor: string, cursor?: string, limit = BSKY_PAGE): string {
  return `${BSKY_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${limit}&filter=posts_no_replies${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
}

export const postThreadUrl = (uri: string): string => `${BSKY_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1&parentHeight=0`

/** The bsky.app page of a post (at://<did>/app.bsky.feed.post/<rkey>). */
export const postWebUrl = (handle: string, uri: string): string => `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(uri.split('/').pop() ?? '')}`

/** One post view (app.bsky.feed.defs#postView) as a Feed item; null for what cannot or must not be shown. */
function itemOf(v: unknown): ExtItem | null {
  const post = obj(v)
  const author = obj(post?.author)
  const rec = obj(post?.record)
  const uri = str(post?.uri, 300)
  const handle = str(author?.handle, 253)
  const text = str(rec?.text, REMOTE_TEXT_MAX)
  const at = Date.parse(str(rec?.createdAt, 40))
  if (!URI_RE.test(uri) || !ACTOR_RE.test(handle) || !text || !Number.isFinite(at)) return null
  if (Array.isArray(author?.labels) && author.labels.some((l) => obj(l)?.val === '!no-unauthenticated')) return null
  const embed = obj(post?.embed)
  const type = str(embed?.$type, 80)
  const external = obj(embed?.external)
  const cardUrl = safeRemoteUrl(external?.uri)
  const image = type.startsWith('app.bsky.embed.images') && Array.isArray(embed?.images) ? safeRemoteUrl(obj(embed.images[0])?.thumb, false, true) : undefined
  const video = type.startsWith('app.bsky.embed.video')
  const thumb = image ?? (video ? safeRemoteUrl(embed?.thumbnail, false, true) : undefined)
  return {
    id: uri, at, text, url: postWebUrl(handle, uri), who: str(author?.displayName, 100) || handle, handle: `@${handle}`,
    ...(cardUrl ? { card: { url: cardUrl, title: str(external?.title, 200) || cardUrl } } : {}),
    ...(thumb ? { imageUrl: thumb } : {}),
    ...(video ? { video: true as const } : {}),
  }
}

/** An account's latest posts (no replies; reposts named), and the cursor of the next page; or why not. */
export async function fetchAuthorFeed(actor: string, f: FetchFn, cursor?: string): Promise<{ items: ExtItem[]; cursor?: string } | RemoteProblem> {
  if (!ACTOR_RE.test(actor)) return 'malformed'
  const raw = await getJsonOrProblem(authorFeedUrl(actor, cursor), f)
  if (isRemoteProblem(raw)) return raw
  const v = obj(raw)
  if (!v || !Array.isArray(v.feed)) return 'malformed'
  const items = v.feed.slice(0, 100).flatMap((x): ExtItem[] => {
    const item = itemOf(obj(x)?.post)
    if (!item) return []
    const reason = obj(obj(x)?.reason)
    const by = obj(reason?.by)
    const repostBy = str(reason?.$type, 80).endsWith('#reasonRepost') ? str(by?.displayName, 100) || str(by?.handle, 253) : ''
    return [repostBy ? { ...item, repostBy } : item]
  })
  const next = str(v.cursor, 100)
  return { items, ...(next ? { cursor: next } : {}) }
}

/** One post and its direct replies, or why not. */
export async function fetchPostThread(uri: string, f: FetchFn): Promise<{ post: ExtItem; replies: ExtItem[] } | RemoteProblem> {
  if (!URI_RE.test(uri)) return 'malformed'
  const v = await getJsonOrProblem(postThreadUrl(uri), f)
  if (isRemoteProblem(v)) return v
  const thread = obj(obj(v)?.thread)
  const post = itemOf(thread?.post)
  if (!post) return 'malformed'
  const replies = (Array.isArray(thread?.replies) ? thread.replies : []).slice(0, 50).flatMap((r) => { const i = itemOf(obj(r)?.post); return i ? [i] : [] })
  return { post, replies }
}

/** A handle's did (com.atproto.identity.resolveHandle on the public AppView); a did is returned as it is. */
export async function resolveHandle(handle: string, f: FetchFn): Promise<string | RemoteProblem> {
  if (handle.startsWith('did:')) return ACTOR_RE.test(handle) ? handle : 'malformed'
  if (!ACTOR_RE.test(handle)) return 'malformed'
  const v = await getJsonOrProblem(`${BSKY_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, f)
  if (isRemoteProblem(v)) return v
  const did = str(obj(v)?.did, 253)
  return did.startsWith('did:') && ACTOR_RE.test(did) ? did : 'malformed'
}
