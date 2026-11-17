// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob κ): the public PeerTube reader. Each instance's own REST API (no login, CORS open): an account's videos
 * (/api/v1/accounts/<name>/videos, newest first, paged), one video (/api/v1/videos/<id>, full description) and oEmbed (title, author, thumbnail;
 * its iframe `html` is never read). Pure apart from the injected fetch; every read is one GET through remote_read.ts. Only public, safe-for-work
 * videos; a video is text (title + description) + thumbnail + link, never a player (the Feed's embed path stays the one way to show more).
 * apps/mcp loads it under plain node: value imports by their `.ts` path.
 */
import { getJsonOrProblem, isPublicHost, isRemoteProblem, LOCAL_HOST_RE, REMOTE_TEXT_MAX, safeRemoteUrl, stripRemoteUnsafe } from './remote_read.ts'
import type { FetchFn, RemoteProblem } from './remote_read.ts'
import type { ExtItem } from './feed_ext_sources.ts'

/** Videos per read (the API allows up to 100). */
export const PEERTUBE_PAGE = 15
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/
const ID_RE = /^[A-Za-z0-9-]{6,64}$/
const PUBLIC_PRIVACY = 1

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : undefined)
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? stripRemoteUnsafe(v).trim().slice(0, max) : '')

/** https://<host>, or http:// for a local test instance where allowed; null for anything else. */
function baseOf(host: string, allowLocal: boolean): string | null {
  if (isPublicHost(host)) return `https://${host}`
  return allowLocal && LOCAL_HOST_RE.test(host) ? `http://${host}` : null
}

export function accountVideosUrl(host: string, name: string, start = 0, allowLocal = false): string | null {
  const base = baseOf(host, allowLocal)
  return base && NAME_RE.test(name) ? `${base}/api/v1/accounts/${encodeURIComponent(name)}/videos?count=${PEERTUBE_PAGE}&start=${start}&sort=-publishedAt` : null
}

export const videoUrl = (host: string, id: string, allowLocal = false): string | null => {
  const base = baseOf(host, allowLocal)
  return base && ID_RE.test(id) ? `${base}/api/v1/videos/${id}` : null
}

/** The oEmbed address for a watch link on that same instance. */
export const oembedUrl = (host: string, watchUrl: string, allowLocal = false): string | null => {
  const base = baseOf(host, allowLocal)
  return base && watchUrl.startsWith(`${base}/`) ? `${base}/services/oembed?format=json&url=${encodeURIComponent(watchUrl)}` : null
}

/** One video object as a Feed item; null when it is not public, not safe for work, or not a video. */
function itemOf(v: unknown, host: string, allowLocal: boolean): ExtItem | null {
  const o = obj(v)
  const uuid = str(o?.uuid, 64)
  const name = str(o?.name, 300)
  const at = Date.parse(str(o?.publishedAt, 40))
  if (!o || !ID_RE.test(uuid) || !name || !Number.isFinite(at) || o.nsfw === true) return null
  const privacy = obj(o.privacy)?.id
  if (privacy !== undefined && privacy !== PUBLIC_PRIVACY) return null
  const account = obj(o.account)
  const short = str(o.shortUUID, 64)
  const base = baseOf(host, allowLocal) ?? ''
  const thumbPath = str(o.thumbnailPath, 300)
  const imageUrl = thumbPath.startsWith('/') ? safeRemoteUrl(base + thumbPath, allowLocal, true) : undefined
  const acct = str(account?.name, 64)
  const description = str(o.description, REMOTE_TEXT_MAX)
  return {
    id: `peertube:${host}:${uuid}`, at, text: [name, description].filter(Boolean).join('\n').slice(0, REMOTE_TEXT_MAX),
    url: safeRemoteUrl(o.url, allowLocal) ?? `${base}/w/${encodeURIComponent(ID_RE.test(short) ? short : uuid)}`,
    who: str(account?.displayName, 100) || acct || host, video: true,
    ...(NAME_RE.test(acct) ? { handle: `@${acct}@${str(account?.host, 253) || host}` } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  }
}

/** An account's latest public videos and the start of the next page (absent on the last); or why not. */
export async function fetchAccountVideos(host: string, name: string, f: FetchFn, start = 0, allowLocal = false): Promise<{ items: ExtItem[]; total: number; next?: number } | RemoteProblem> {
  const url = accountVideosUrl(host, name, start, allowLocal)
  if (!url) return 'malformed'
  const raw = await getJsonOrProblem(url, f)
  if (isRemoteProblem(raw)) return raw
  const v = obj(raw)
  if (!v || !Array.isArray(v.data)) return 'malformed'
  const total = typeof v.total === 'number' && Number.isFinite(v.total) ? v.total : 0
  const items = v.data.slice(0, 100).flatMap((x) => { const i = itemOf(x, host, allowLocal); return i ? [i] : [] })
  const next = start + v.data.length
  return { items, total, ...(v.data.length && next < total ? { next } : {}) }
}

/** One video with its full description, or why not. */
export async function fetchVideo(host: string, id: string, f: FetchFn, allowLocal = false): Promise<ExtItem | RemoteProblem> {
  const url = videoUrl(host, id, allowLocal)
  if (!url) return 'malformed'
  const raw = await getJsonOrProblem(url, f)
  if (isRemoteProblem(raw)) return raw
  return itemOf(raw, host, allowLocal) ?? 'malformed'
}

/** A video's oEmbed: title, author and thumbnail only (the player html is never read); or why not. */
export async function fetchOembed(host: string, watchUrl: string, f: FetchFn, allowLocal = false): Promise<{ title: string; author?: string; thumbnailUrl?: string } | RemoteProblem> {
  const url = oembedUrl(host, watchUrl, allowLocal)
  if (!url) return 'malformed'
  const raw = await getJsonOrProblem(url, f)
  if (isRemoteProblem(raw)) return raw
  const v = obj(raw)
  const title = str(v?.title, 300)
  if (!title) return 'malformed'
  const author = str(v?.author_name, 100)
  const thumbnailUrl = safeRemoteUrl(v?.thumbnail_url, allowLocal, true)
  return { title, ...(author ? { author } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) }
}
