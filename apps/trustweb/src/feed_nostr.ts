// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Group posts over Nostr relays (NIP-29 relay-based groups; Jakob 2026-11-05,
 * "consider how Hylo does it"): a post is a signed kind 9 event carrying the
 * group id in an `h` tag and a Hylo-style type (discussion / request / offer /
 * event); one event per group, so a post may go to several groups at once.
 * Join is kind 9021, leave 9022; member lists are the `p` tags of 39002.
 * Pure: builds and parses events, never touches a network (feed_relay.ts does,
 * and only where a relay is set). The secret key stays in the record on this
 * phone; only signatures leave it.
 */
import { bytesToHex, finalizeEvent, generateSecretKey, hexToBytes, verifyEvent } from '../../demo/src/nostr_lib'
import type { ColourTag } from './colour_tags'
import { addGroupPost } from './feed_sources'
import type { AppState, GroupPost } from './model'

export const POST_TYPES = ['discussion', 'request', 'offer', 'event'] as const
export type PostType = (typeof POST_TYPES)[number]

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

/** The group id on the relay: our `tag:x` / `event:x` ids with the colon made relay-safe. */
export const groupTag = (group: string): string => group.replace(/[^a-zA-Z0-9_-]/g, '-')

const isType = (v: unknown): v is PostType => POST_TYPES.includes(v as PostType)

function sign(sk: string, kind: number, group: string, content: string, now: number, extra: string[][] = []): NostrEvent {
  return finalizeEvent({ kind, created_at: Math.floor(now / 1000), tags: [['h', groupTag(group)], ...extra], content }, hexToBytes(sk)) as NostrEvent
}

export const buildPost = (sk: string, group: string, text: string, type: PostType, now: number): NostrEvent => sign(sk, 9, group, text, now, [['type', type]])
export const buildJoin = (sk: string, group: string, now: number): NostrEvent => sign(sk, 9021, group, '', now)
export const buildLeave = (sk: string, group: string, now: number): NostrEvent => sign(sk, 9022, group, '', now)

export interface ParsedPost { id: string; group: string; type: PostType; text: string; at: number; pubkey: string }

/** A group post event, only if its signature holds; a missing or unknown type reads as a discussion. */
export function parseGroupPost(ev: Pick<NostrEvent, 'kind' | 'tags'> & Partial<NostrEvent>): ParsedPost | null {
  if (ev.kind !== 9 || !Array.isArray(ev.tags)) return null
  const { id, pubkey, created_at, kind, tags, content, sig } = ev as NostrEvent
  if (!verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })) return null
  const group = tags.find((t) => t[0] === 'h')?.[1]
  const type = tags.find((t) => t[0] === 'type')?.[1]
  if (!group || typeof content !== 'string') return null
  return { id, group, type: isType(type) ? type : 'discussion', text: content, at: created_at * 1000, pubkey }
}

/** Member public keys of a relay's 39002 member-list event. */
export const parseMembers = (ev: Pick<NostrEvent, 'kind' | 'tags'>): string[] => (ev.kind === 39002 ? ev.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]) : [])

/** A relay address: wss only (ws where allowLocal, for a dev relay), no path, trailing slash dropped. */
export function parseRelay(input: string, allowLocal = false): string | null {
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'wss:' && !(allowLocal && u.protocol === 'ws:')) return null
    return u.href.replace(/\/$/, '')
  } catch { return null }
}

/** The Nostr secret key (hex), generated once and kept in the record. */
export function ensureNostrKey(s: AppState): string {
  if (!s.nostrKey) s.nostrKey = bytesToHex(generateSecretKey())
  return s.nostrKey
}

/** Posts to several groups at once: one record post and one signed event per group the person is in. */
export function addGroupPosts(s: AppState, groups: readonly string[], text: string, type: PostType, now: number, tags: readonly ColourTag[], sk: string): { posts: GroupPost[]; events: NostrEvent[] } {
  const posts = groups.flatMap((g) => { const p = addGroupPost(s, g, text, now, tags); return p ? [Object.assign(p, { type })] : [] })
  return { posts, events: posts.map((p) => buildPost(sk, p.group, p.text, type, now)) }
}
