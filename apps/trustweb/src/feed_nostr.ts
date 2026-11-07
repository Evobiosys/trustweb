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
import type { Group } from './feed_sources'
import { Ring } from './model'
import type { AppState, GroupPost } from './model'

export const POST_TYPES = ['discussion', 'request', 'offer', 'event'] as const
export type PostType = (typeof POST_TYPES)[number]

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

/** The group id on the relay: our `tag:x` / `event:x` ids with the colon made relay-safe. */
export const groupTag = (group: string): string => group.replace(/[^a-zA-Z0-9_-]/g, '-')

const isType = (v: unknown): v is PostType => POST_TYPES.includes(v as PostType)

/** Group governance (NAOMS has five modes; Jakob 2026-11-05). Only `vouch` acts so far, the rest is shown as a label. */
export const GOVERNANCE = ['open', 'invite', 'vouch', 'admin', 'consensus'] as const
export type Governance = (typeof GOVERNANCE)[number]
const isGovernance = (v: unknown): v is Governance => GOVERNANCE.includes(v as Governance)

/** Per group, kept in the record (AppState.feed.groupMeta): the 39000-style fields, channels, and who vouched for me. */
export interface GroupMeta { governance?: Governance; channels?: { id: string; name: string }[]; vouchedBy?: string[] }
export type GroupMetas = Record<string, GroupMeta | undefined>

/** A channel is a NIP-29 subgroup with its own relay id. */
export const channelTag = (group: string, channel: string): string => `${groupTag(group)}_${channel}`

/** Posting is open, except under `vouch`: one member must have vouched for me. */
export const canPost = (m?: GroupMeta): boolean => m?.governance !== 'vouch' || (m.vouchedBy?.length ?? 0) > 0

/** Relay h id -> our group (and channel), for every group and channel I am in. */
export function tagIndex(groups: readonly Group[], metas: GroupMetas = {}): Map<string, { group: string; channel?: string }> {
  return new Map(groups.flatMap((g) => [
    [groupTag(g.id), { group: g.id }] as const,
    ...(metas[g.id]?.channels ?? []).map((c) => [channelTag(g.id, c.id), { group: g.id, channel: c.id }] as const),
  ]))
}

/** Trust distance of a person by ring: closest, close, friends 1; acquaintances 2; anyone else unknown. */
export const hopsOf = (ring?: Ring): number | null => (ring === Ring.Closest || ring === Ring.Close || ring === Ring.Friend ? 1 : ring === Ring.Acquaintance ? 2 : null)

/** 0 = members only, 1 = friends of members, 2 = friends of friends: members always see it, others by their trust distance to the author. */
export const visibleByHops = (hops: number, distance: number | null, member: boolean): boolean => member || (distance !== null && distance <= hops)

function sign(sk: string, kind: number, h: string, content: string, now: number, extra: string[][] = []): NostrEvent {
  return finalizeEvent({ kind, created_at: Math.floor(now / 1000), tags: [['h', h], ...extra], content }, hexToBytes(sk)) as NostrEvent
}

export interface PostOpts { hops?: number; channel?: string }
export const buildPost = (sk: string, group: string, text: string, type: PostType, now: number, o: PostOpts = {}): NostrEvent =>
  sign(sk, 9, o.channel ? channelTag(group, o.channel) : groupTag(group), text, now, [['type', type], ['hops', String(o.hops ?? 0)]])
export const buildJoin = (sk: string, group: string, now: number): NostrEvent => sign(sk, 9021, groupTag(group), '', now)
export const buildLeave = (sk: string, group: string, now: number): NostrEvent => sign(sk, 9022, groupTag(group), '', now)

/** The group (or channel) metadata record as a 39000 event: name, governance, and the parent group for a channel. */
export const buildMetadata = (sk: string, group: string, m: { name: string; governance: Governance; parent?: string }, now: number): NostrEvent =>
  sign(sk, 39000, groupTag(group), '', now, [['d', groupTag(group)], ['name', m.name], ['governance', m.governance], ...(m.parent ? [['parent', groupTag(m.parent)]] : [])])

export function parseMetadata(ev: Pick<NostrEvent, 'kind' | 'tags'>): { id: string; name: string; governance: Governance; parent?: string } {
  const get = (k: string): string | undefined => ev.tags.find((t) => t[0] === k)?.[1]
  const g = get('governance')
  return { id: get('d') ?? '', name: get('name') ?? '', governance: isGovernance(g) ? g : 'open', ...(get('parent') ? { parent: get('parent') } : {}) }
}

export interface ParsedPost { id: string; group: string; type: PostType; hops: number; text: string; at: number; pubkey: string }

/** A group post event, only if its signature holds; a missing or unknown type reads as a discussion. */
export function parseGroupPost(ev: Pick<NostrEvent, 'kind' | 'tags'> & Partial<NostrEvent>): ParsedPost | null {
  if (ev.kind !== 9 || !Array.isArray(ev.tags)) return null
  const { id, pubkey, created_at, kind, tags, content, sig } = ev as NostrEvent
  if (!verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })) return null
  const group = tags.find((t) => t[0] === 'h')?.[1]
  const type = tags.find((t) => t[0] === 'type')?.[1]
  const hops = Number(tags.find((t) => t[0] === 'hops')?.[1])
  if (!group || typeof content !== 'string') return null
  return { id, group, type: isType(type) ? type : 'discussion', hops: hops === 1 || hops === 2 ? hops : 0, text: content, at: created_at * 1000, pubkey }
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

export type Target = string | { group: string; channel?: string }

/** Posts to several groups or channels at once: one record post and one signed event per target the person may post to (a member, a known channel, vouched where the group asks). */
export function addGroupPosts(s: AppState, targets: readonly Target[], text: string, type: PostType, now: number, tags: readonly ColourTag[], sk: string, o: { hops?: number; meta?: GroupMetas } = {}): { posts: GroupPost[]; events: NostrEvent[] } {
  const hops = o.hops ?? 0
  const posts: GroupPost[] = []
  const events: NostrEvent[] = []
  for (const t of targets) {
    const { group, channel } = typeof t === 'string' ? { group: t, channel: undefined } : t
    const m = o.meta?.[group]
    if (!canPost(m) || (channel && !m?.channels?.some((c) => c.id === channel))) continue
    const p = addGroupPost(s, group, text, now, tags)
    if (!p) continue
    Object.assign(p, { type, hops }, channel ? { channel } : {})
    posts.push(p)
    events.push(buildPost(sk, group, p.text, type, now, { hops, channel }))
  }
  return { posts, events }
}
