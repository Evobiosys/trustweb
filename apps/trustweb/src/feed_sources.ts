// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Feed sources (wave 31): the groups the person is in and their posts, the
 * Mastodon accounts / hashtags and the news feed they follow (public RSS or
 * JSON Feed), and the chip counts. Pure apart from the share line it appends.
 * Privacy: only groups the person is in are listed or posted to, and a post
 * reaches the group through a share line scoped to that group alone, so
 * membership is never shown beyond it.
 */
import type { ColourTag } from './colour_tags'
import { PostKind, sourceOf } from './feed'
import type { FeedSource, Post } from './feed'
import { htmlToText, instanceBase, parseHandle, safeRemoteUrl } from './fediverse'
import type { AppState, GroupPost } from './model'
import { zoneTagIds } from './zone_tags'
import { appendShare } from './share_sink/share_lines'
import { Zone } from './share_sink/zones'

export interface Group { id: string; name: string }

/** The groups the person is in: tags kept on a zone (`tag:<id>`) and events they attended (`event:<id>`). */
export function groupsOf(s: Pick<AppState, 'zoneTags' | 'events'>, tags: readonly ColourTag[]): Group[] {
  const zoned = new Set(Object.keys(s.zoneTags ?? {}).flatMap((z) => zoneTagIds(s, z)))
  return [
    ...tags.filter((t) => zoned.has(t.id)).map((t) => ({ id: `tag:${t.id}`, name: t.label ?? t.id })),
    ...(s.events ?? []).filter((e) => e.attended).map((e) => ({ id: `event:${e.id}`, name: e.name })),
  ]
}

/** Posts the person made to a group they are in: a record line plus a share line to that group only. Null: not a member, or empty. */
export function addGroupPost(s: AppState, group: string, text: string, now: number, tags: readonly ColourTag[] = []): GroupPost | null {
  const clean = text.trim()
  if (!clean || !groupsOf(s, tags).some((g) => g.id === group)) return null
  const post: GroupPost = { id: `${now.toString(36)}${(s.groupPosts?.length ?? 0).toString(36)}`, kind: 'post', group, text: clean, by: s.me.displayName, at: now }
  s.groupPosts = [...(s.groupPosts ?? []), post]
  s.shares = appendShare(s.shares ?? [], { id: `item:post:${post.id}`, scope: { zone: Zone.Self, include: [group], exclude: [] }, to: `group:${group}`, ts: new Date(now).toISOString() })
  return post
}

/** Group posts as Feed posts, for groups the person is in only. */
export function groupPosts(s: AppState, tags: readonly ColourTag[]): Post[] {
  const names = new Map(groupsOf(s, tags).map((g) => [g.id, g.name]))
  return (s.groupPosts ?? []).filter((p) => names.has(p.group)).map((p): Post => ({
    id: `group:${p.id}`, kind: PostKind.Group, who: p.by === s.me.displayName ? null : p.by, at: p.at, text: p.text, context: names.get(p.group), group: p.group, dummy: false, open: { kind: 'none' },
  }))
}

export interface Follow { kind: 'account' | 'tag'; name: string; host: string }

/** "@user@host" (account) or "#tag@host" (hashtag); anything else is null. */
export function parseFollow(input: string, allowLocal = false): Follow | null {
  const raw = input.trim()
  const tag = raw.startsWith('#')
  const h = parseHandle(tag ? raw.slice(1) : raw, allowLocal)
  return h ? { kind: tag ? 'tag' : 'account', name: h.user, host: h.host } : null
}

export const followText = (f: Follow): string => `${f.kind === 'tag' ? '#' : '@'}${f.name}@${f.host}`

/** The public RSS of an account or hashtag (no login). */
export const followUrl = (f: Follow | null): string => (f ? `${instanceBase(f.host)}/${f.kind === 'tag' ? `tags/${encodeURIComponent(f.name)}` : `@${encodeURIComponent(f.name)}`}.rss` : '')

export interface FeedItem { id: string; at: number; text: string; url?: string }

const ITEMS_MAX = 20
const tagText = (block: string, tag: string): string => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : ''
}
const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
const fix = (d: string, at: number): number => { const t = Date.parse(d); return Number.isFinite(t) ? t : at }

/** RSS 2.0 or JSON Feed text -> plain-text items (remote markup never kept, links must be public https). Garbage -> []. */
export function parseFeedText(raw: string, allowLocal = false): FeedItem[] {
  const text = raw.trim()
  try {
    if (text.startsWith('{')) {
      const items = (JSON.parse(text) as { items?: unknown }).items
      return (Array.isArray(items) ? items : []).slice(0, ITEMS_MAX).flatMap((x): FeedItem[] => {
        const o = x as Record<string, unknown>
        if (typeof o !== 'object' || o === null) return []
        const body = [o.title, typeof o.content_text === 'string' ? o.content_text : typeof o.content_html === 'string' ? htmlToText(o.content_html) : ''].filter((v): v is string => typeof v === 'string' && v !== '').join('\n')
        const url = safeRemoteUrl(o.url, allowLocal)
        const id = String(o.id ?? o.url ?? '').slice(0, 200)
        return body && id ? [{ id, at: typeof o.date_published === 'string' ? fix(o.date_published, 0) : 0, text: htmlToText(body), ...(url ? { url } : {}) }] : []
      })
    }
  } catch { return [] }
  return (text.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []).slice(0, ITEMS_MAX).flatMap((block): FeedItem[] => {
    const body = htmlToText(decode(tagText(block, 'description') || tagText(block, 'title')))
    const url = safeRemoteUrl(decode(tagText(block, 'link')).trim(), allowLocal)
    const id = (decode(tagText(block, 'guid')).trim() || url || '').slice(0, 200)
    return body && id ? [{ id, at: fix(tagText(block, 'pubDate'), 0), text: body, ...(url ? { url } : {}) }] : []
  })
}

/** Items of one followed feed as Feed posts: `who` is the follow's label (an account, a hashtag, or the news feed). */
export function followPosts(label: string, items: readonly FeedItem[], news: boolean): Post[] {
  return items.map((i): Post => ({
    id: `follow:${label}:${i.id}`, kind: PostKind.Follow, who: label, at: i.at, text: i.text, dummy: false, news,
    open: i.url ? { kind: 'url', url: i.url } : { kind: 'none' },
  }))
}

/** How many items each chip holds. */
export function sourceCounts(posts: readonly Post[]): Record<FeedSource, number> {
  const out = { web: 0, group: 0, fediverse: 0, news: 0, ask: 0 } as Record<FeedSource, number>
  for (const p of posts) out[sourceOf(p)]++
  return out
}

