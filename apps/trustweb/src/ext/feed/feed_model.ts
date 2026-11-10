// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Feed view's model. Pure, no DOM, no network.
 * The timeline reuses the Community view's post builder (community_model.buildPosts: feed items, group posts, co-notes); this file adds
 * my own posts (`AppState.extData['feed-view']`), the audience choice and the link card for a pasted social-media link.
 * A post to a tag I joined goes through the existing group post (one copy, the share line carries it); a post to a trust zone has no carrier
 * yet and stays "only on this phone".
 */
import type { ColourTag } from '../../colour_tags'
import { addGroupPost, groupsOf } from '../../feed_sources'
import type { AppState } from '../../model'
import { buildPosts } from '../community-mighty/community_model'

export const MODULE_ID = 'feed-view'
/** Trust zones a post may name, narrowest first (never wider than Friends, like a support ask). */
const RING_ZONES = ['ring:closest', 'ring:close', 'ring:friend'] as const

export interface FeedPost { id: string; text: string; zone: string; at: number }
export interface FeedData {
  posts?: FeedPost[]
  /** Fetch a richer preview through my TrustWeb host (off unless the user turns it on). */
  preview?: true
}

const isStr = (v: unknown): v is string => typeof v === 'string'

export function parseFeed(raw: unknown): FeedData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: FeedData = {}
  if (Array.isArray(o.posts)) d.posts = o.posts.filter((p): p is FeedPost => !!p && typeof p === 'object' && isStr(p.id) && isStr(p.text) && isStr(p.zone) && typeof p.at === 'number').map((p) => ({ id: p.id, text: p.text, zone: p.zone, at: p.at }))
  if (o.preview === true) d.preview = true
  return d
}

/** Two of my devices: posts join by id (this device's copy first); the incoming value wins for the switch. */
export function mergeFeed(mineRaw: unknown, theirsRaw: unknown): FeedData {
  const a = parseFeed(mineRaw)
  const b = parseFeed(theirsRaw)
  const out: FeedData = { ...a, ...b }
  const posts = new Map([...(a.posts ?? []), ...(b.posts ?? [])].map((p) => [p.id, p]))
  if (posts.size) out.posts = [...posts.values()]
  return out
}

// ---- link cards -------------------------------------------------------------

export interface LinkCard { href: string; host: string; platform?: string; handle?: string; title: string }

const PLATFORMS: readonly [string, string][] = [
  ['x.com', 'X'], ['twitter.com', 'X'], ['facebook.com', 'Facebook'], ['fb.com', 'Facebook'], ['linkedin.com', 'LinkedIn'], ['instagram.com', 'Instagram'],
  ['bsky.app', 'Bluesky'], ['threads.net', 'Threads'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'], ['t.me', 'Telegram'], ['reddit.com', 'Reddit'], ['tiktok.com', 'TikTok'],
]
const TRACKING = /^(utm_.*|fbclid|igshid|gclid|ref_src|mc_cid|mc_eid)$/
const X_HOSTS = new Set(['x.com', 'twitter.com'])
const TITLE_MAX = 120

/** The first http(s) link in a text, without the punctuation that ends a sentence. */
export function firstLink(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text)
  return m ? m[0].replace(/[.,;:!?)\]]+$/, '') : null
}

const words = (seg: string): string => { try { return decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim() } catch { return seg } }
const clip = (s: string): string => (s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1) + '…' : s)

/**
 * A card from the link alone: no request is made. Host, platform, author and a title read from the path; tracking parameters removed.
 * Null for anything but http(s) or a link that carries credentials.
 */
export function linkCard(raw: string): LinkCard | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
  const host = u.hostname.replace(/^(www|m|mobile)\./, '')
  const isX = X_HOSTS.has(host)
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k) || (isX && (k === 's' || k === 't'))) u.searchParams.delete(k)
  u.hash = ''
  const segs = u.pathname.split('/').filter(Boolean)
  const platform = PLATFORMS.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1]
  const card = (extra: Partial<LinkCard> & { title: string }): LinkCard => ({ href: u.href, host, ...(platform ? { platform } : {}), ...extra, title: clip(extra.title) })

  const mast = /^@([^/@]+)$/.exec(segs[0] ?? '')
  if (mast && !platform) {
    const handle = `@${mast[1]}@${host}`
    return card({ platform: 'Mastodon', handle, title: segs[1] ? `Post by ${handle}` : handle })
  }
  if (isX && segs[1] === 'status') return card({ handle: `@${segs[0]}`, title: `Post by @${segs[0]}` })
  if (platform === 'Bluesky' && segs[0] === 'profile' && segs[1]) {
    const handle = `@${segs[1]}`
    return card({ handle, title: segs[2] === 'post' ? `Post by ${handle}` : handle })
  }
  if (!segs.length) return card({ title: host })
  if (platform === 'Facebook' || platform === 'Instagram') return card({ title: segs.map((x) => words(x)).join(' › ') })
  return card({ title: words(segs[segs.length - 1]) || host })
}

/**
 * The answer of GET /api/preview?url=… on my TrustWeb host (optional; the endpoint does not exist on questhub yet, see the report).
 * Only a short title is taken; anything else in the answer is dropped, so the host cannot inject markup.
 */
export function parsePreview(raw: unknown): { title: string } | null {
  const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).title : undefined
  const title = isStr(t) ? t.trim() : ''
  return title ? { title: clip(title) } : null
}

// ---- audience and composer ------------------------------------------------------

/** The audience dropdown: the three zones, then every colour tag. */
export const ZONES_OFFERED = (tags: readonly ColourTag[]): string[] => [...RING_ZONES, ...tags.map((t) => `tag:${t.id}`)]
export const zoneValid = (zone: string, tags: readonly ColourTag[]): boolean => ZONES_OFFERED(tags).includes(zone)

/**
 * Adds a post. 'group' = a tag I joined, sent as a group post (the share line carries it); 'own' = kept in my slice, on this phone
 * until a carrier exists; null = empty text or an unknown zone. Mutates `s` (group post) and `d` (own post); the caller saves both.
 */
export function composePost(s: AppState, d: FeedData, input: { text: string; zone: string }, tags: readonly ColourTag[], now: number): 'group' | 'own' | null {
  const text = input.text.trim()
  if (!text || !zoneValid(input.zone, tags)) return null
  if (input.zone.startsWith('tag:') && groupsOf(s, tags).some((g) => g.id === input.zone)) return addGroupPost(s, input.zone, text, now, tags) ? 'group' : null
  d.posts = [...(d.posts ?? []), { id: `f${now.toString(36)}${(d.posts?.length ?? 0).toString(36)}`, text, zone: input.zone, at: now }]
  return 'own'
}

// ---- timeline -------------------------------------------------------------------

export interface TimelineItem {
  id: string; who: string | null; personId?: string; at: number; text: string
  /** Where I posted it (a zone key); absent for what others sent. */
  zone?: string
  /** The audience chip text: the zone's label or the space's name. */
  audience?: string
  unsent?: true
  link: LinkCard | null
}

/** Newest first. `labelOf` names a zone key for the chip (the view passes the user strings). */
export function buildTimeline(s: AppState, d: FeedData, tags: readonly ColourTag[], labelOf: (zone: string) => string): TimelineItem[] {
  const others = buildPosts(s, tags).map((p): TimelineItem => ({
    id: p.id, who: p.who, ...(p.personId ? { personId: p.personId } : {}), at: p.at, text: p.text, ...(p.space ? { audience: p.space } : {}), ...(p.unsent ? { unsent: true as const } : {}), link: null,
  }))
  const mine = (d.posts ?? []).map((p): TimelineItem => ({ id: p.id, who: null, at: p.at, text: p.text, zone: p.zone, audience: labelOf(p.zone), unsent: true, link: null }))
  return [...mine, ...others].sort((a, b) => b.at - a.at).map((p) => {
    const url = firstLink(p.text)
    return { ...p, link: url ? linkCard(url) : null }
  })
}
