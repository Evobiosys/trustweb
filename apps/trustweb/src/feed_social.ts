// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The social Feed (wave 43, Jakob at the Winter IYG: "feed should be something like Mastodon"): posts by people, newest first, each with a
 * name, an age and a text, and two light answers, Reply and Star. The Feed shows what people wrote (my own posts, group posts, the fediverse,
 * followed feeds); the Timeline (feed.ts kinds Answer, Meeting, Note, Mine, Ask) keeps the record of what happened.
 * Structure and interaction pattern after Mastodon's status list (author line, text, reply and favourite buttons, a "reply to" line);
 * no Mastodon (AGPL) source is used. Pure, the record only, no network (feed_view.ts sends event posts through the existing relay).
 * A leaf on purpose: no value imports, so apps/mcp loads it under plain node (the app's extension-less imports do not load there).
 */
import type { AppState, SocialPost, TwEvent } from './model'

/** event_tag.ts EVENT_SLUG_CASE, repeated (flip both; review_fixes_43.test.mjs fails while they differ). */
export const EVENT_SLUG_CASE: 'lower' | 'keep' = 'keep'

/** event_tag.ts eventTagSlug, repeated character for character: this leaf loads under plain node, where an extension-less value import fails; review_fixes_43.test.mjs proves the two agree. */
function slugOf(name: string): string {
  const cased = EVENT_SLUG_CASE === 'lower' ? name.trim().toLowerCase() : name.trim()
  return `event_${cased.replace(/[^\p{L}\p{N}\s_]+/gu, '').replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '')}`
}

/** event_tag.ts sameEventTag, repeated: event tags match whatever their letter case. */
export const sameEventTag = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()

/** The tag of an event on this device: its tag name (events.ts tagLabel) as `event_<slug>`. */
export const tagOfEvent = (ev: Pick<TwEvent, 'name' | 'tagName'>): string => slugOf(ev.tagName ?? ev.name)

/** The event page's Feed row shows only when the event offers a Feed (`offers.feed === true`, set by the event page; absent or malformed = off). */
export function eventFeedOn(ev: object): boolean {
  const offers = (ev as { offers?: unknown }).offers
  return typeof offers === 'object' && offers !== null && (offers as { feed?: unknown }).feed === true
}

export interface PostOpts { eventId?: string; replyTo?: string; replyText?: string; /** answers-44b: a tag for a post on no event (a shared block's ref:<resource>.<block>); an event's tag wins. */ tag?: string }

/** A post of mine, kept on this phone. replyTo = the Feed id of the post it answers, replyText a short snapshot of it. Null: empty text or an unknown event. */
export function addSocialPost(s: AppState, text: string, now: number, o: PostOpts = {}): SocialPost | null {
  const clean = text.trim()
  const ev = o.eventId ? s.events?.find((e) => e.id === o.eventId) : undefined
  if (!clean || (o.eventId && !ev)) return null
  const post: SocialPost = {
    id: `${now.toString(36)}${(s.feedPosts?.length ?? 0).toString(36)}`, text: clean, by: s.me.displayName, at: now,
    ...(ev ? { tag: tagOfEvent(ev), eventId: ev.id } : o.tag ? { tag: o.tag } : {}), ...(o.replyTo ? { replyTo: o.replyTo, replyText: (o.replyText ?? '').slice(0, 120) } : {}),
  }
  s.feedPosts = [...(s.feedPosts ?? []), post]
  return post
}

/** Changes the text of one of my posts (the id without `social:`); false: unknown post or empty text. */
export function editSocialPost(s: AppState, id: string, text: string): boolean {
  const post = s.feedPosts?.find((p) => p.id === id)
  if (!post || !text.trim()) return false
  post.text = text.trim()
  return true
}

/** Stars or un-stars a post (any Feed post id); true = starred now. */
export function toggleStar(s: AppState, postId: string): boolean {
  const have = s.feedStars ?? []
  const on = !have.includes(postId)
  s.feedStars = on ? [...have, postId] : have.filter((x) => x !== postId)
  return on
}

export interface ListedPost { id: string; kind: 'social' | 'group'; by: string; at: number; text: string; tag?: string; starred: boolean }

/** MCP feed_list: my posts and the posts of the groups of events I attended, newest first, of one event when given. Reads the record only. */
export function feedList(s: AppState, o: { eventId?: string; limit?: number }): ListedPost[] {
  const ev = o.eventId ? s.events?.find((e) => e.id === o.eventId) : undefined
  if (o.eventId && !ev) throw new Error(`no event "${o.eventId}"`)
  const stars = new Set(s.feedStars ?? [])
  const attended = new Map((s.events ?? []).filter((e) => e.attended).map((e) => [`event:${e.id}`, tagOfEvent(e)]))
  const mine = (s.feedPosts ?? []).map((p): ListedPost => ({ id: `social:${p.id}`, kind: 'social', by: p.by, at: p.at, text: p.text, ...(p.tag ? { tag: p.tag } : {}), starred: stars.has(`social:${p.id}`) }))
  const groups = (s.groupPosts ?? []).filter((p) => attended.has(p.group)).map((p): ListedPost => ({ id: `group:${p.id}`, kind: 'group', by: p.by, at: p.at, text: p.text, tag: attended.get(p.group), starred: stars.has(`group:${p.id}`) }))
  const tag = ev ? tagOfEvent(ev) : undefined
  return [...mine, ...groups].filter((p) => !tag || sameEventTag(p.tag, tag)).sort((a, b) => b.at - a.at).slice(0, Math.max(0, Math.min(o.limit ?? 150, 150)))
}
