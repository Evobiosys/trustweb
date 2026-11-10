// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the Community view's data, built from what TrustWeb already holds. Pure, no DOM.
 * Spaces = community colour tags; joining one = the tag on my own zone (`zoneTags.self`), which makes it a group I am in
 * (feed_sources.ts groupsOf), so the composer can post to it through the existing share line. The module's own settings and the
 * shared resource list live in `AppState.extData['community-mighty']` (CommunityData).
 */
import type { ColourTag } from '../../colour_tags'
import { hasColourTag } from '../../colour_tags'
import { alive } from '../../deleted_people'
import { buildFeed, PostKind } from '../../feed'
import type { AppState, Person, TwEvent } from '../../model'
import { Ring } from '../../model'
import { localDay } from '../../engagement'
import { groupPosts, groupsOf } from '../../feed_sources'
import { communityTags } from '../../trustzones'
import { removeZoneTag, zoneTagIds } from '../../zone_tags'
import { NAV, safeUrl, type CommunityData, type NavId, type Resource, type ResourceView } from './community_data'

export { MODULE_ID, NAV, parseCommunity, safeUrl } from './community_data'
export type { CommunityData, NavId, Resource, ResourceView } from './community_data'
/** The zone key that holds the spaces I joined. */
const SELF = 'self'

export const navItems = (d: CommunityData): NavId[] => NAV.filter((n) => !d.navOff?.includes(n))

/** My own choice, else the community tag of the rings (TrustZones), else the first community tag; null when no tag exists. */
export function communityTagOf(d: CommunityData, s: Pick<AppState, 'uiRings'>, tags: readonly ColourTag[]): string | null {
  const ids = new Set(communityTags(tags).map((t) => t.id))
  for (const id of [d.tag, s.uiRings?.community]) if (id && ids.has(id)) return id
  return communityTags(tags)[0]?.id ?? null
}

/** unsent: a group post no relay took yet (it stays on this phone). */
export interface CommunityPost { id: string; who: string | null; personId?: string; at: number; text: string; context?: string; space?: string; unsent?: true }

/** Home: the feed (minus asks addressed to me, they are not community posts), group posts and co-notes, newest first. `space` keeps one space's posts. */
export function buildPosts(s: AppState, tags: readonly ColourTag[], space?: string): CommunityPost[] {
  const names = new Map(tags.map((t) => [`tag:${t.id}`, t.label ?? t.id]))
  const groups = groupPosts(s, tags).filter((p) => !space || p.group === `tag:${space}`)
    .map((p): CommunityPost => ({ id: p.id, who: p.who, at: p.at, text: p.text, space: (p.group && names.get(p.group)) ?? p.context, ...(p.unsent ? { unsent: true as const } : {}) }))
  if (space) return groups.sort((a, b) => b.at - a.at)
  const feed = buildFeed(s).filter((p) => p.kind !== PostKind.Ask).map((p): CommunityPost => ({ id: p.id, who: p.who, ...(p.personId ? { personId: p.personId } : {}), at: p.at, text: p.text, ...(p.context ? { context: p.context } : {}) }))
  const co = (s.coNotes ?? []).map((d): CommunityPost => ({ id: `co:${d.id}`, who: d.people.map((p) => p.name).join(', ') || null, at: Math.max(0, ...Object.values(d.seen ?? {})), text: d.title }))
  return [...groups, ...feed, ...co].filter((p) => p.text.trim()).sort((a, b) => b.at - a.at)
}

/** joined = a group I am in (groupsOf: the tag on any of my zones); leavable = I joined it here (my own zone), so Leave can undo it. */
export interface Space { id: string; name: string; colour: string; members: number; joined: boolean; leavable: boolean }

const visible = <P extends Pick<Person, 'deleted_at' | 'blocked'>>(people: readonly P[]): P[] => alive(people).filter((p) => !(p.blocked && p.blocked > 0))

export function buildSpaces(s: AppState, tags: readonly ColourTag[]): Space[] {
  const own = new Set(zoneTagIds(s, SELF))
  const groups = new Set(groupsOf(s, tags).map((g) => g.id))
  const people = visible(s.people)
  return communityTags(tags).map((t) => ({ id: t.id, name: t.label ?? t.id, colour: t.colour, members: people.filter((p) => hasColourTag(p, t.id)).length, joined: groups.has(`tag:${t.id}`), leavable: own.has(t.id) }))
}

export function joinSpace(s: AppState, tags: readonly ColourTag[], id: string, now: number): void {
  const have = zoneTagIds(s, SELF)
  if (tags.some((x) => x.id === id) && !have.includes(id)) s.zoneTags = { ...s.zoneTags, [SELF]: { ids: [...have, id], stamp: now } }
}

export function leaveSpace(s: AppState, id: string, now: number): void {
  removeZoneTag(s, SELF, id, now)
}

export interface Member { id: string; name: string; ring: Ring; initial: string }

const RING_ORDER: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Family, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted, Ring.None]

export function buildMembers(people: readonly Person[], tag: string | null): Member[] {
  if (!tag) return []
  const rank = (r: Ring): number => { const i = RING_ORDER.indexOf(r); return i < 0 ? RING_ORDER.length : i }
  return visible(people).filter((p) => hasColourTag(p, tag))
    .sort((a, b) => rank(a.ring) - rank(b.ring) || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, ring: p.ring, initial: (p.name.trim()[0] ?? '?').toUpperCase() }))
}

export interface EventCard { id: string; name: string; day: string; month: string; from: string; to?: string; where: string; host?: string; going: boolean; past: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Upcoming soonest first, then past newest first. Dates are the record's "YYYY-MM-DD" (a time part is ignored); today is the local day. */
export function buildEvents(events: readonly TwEvent[] | undefined, now: number): EventCard[] {
  const today = localDay(new Date(now))
  const cards = (events ?? []).filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.from)).map((e): EventCard => {
    const from = e.from.slice(0, 10)
    return {
      id: e.id, name: e.name, day: String(Number(from.slice(8, 10))), month: MONTHS[Number(from.slice(5, 7)) - 1] ?? '', from, ...(e.to ? { to: e.to.slice(0, 10) } : {}),
      where: e.where, ...(e.hosts?.[0] ?? e.organizer ? { host: e.hosts?.[0] ?? e.organizer } : {}), going: e.attended, past: (e.to ?? e.from).slice(0, 10) < today,
    }
  })
  return [...cards.filter((c) => !c.past).sort((a, b) => a.from.localeCompare(b.from)), ...cards.filter((c) => c.past).sort((a, b) => b.from.localeCompare(a.from))]
}

export interface ViewRow { item: Resource; state: 'shown' | 'new' | 'hidden' }

/** My view over the shared list: my order first, then what others added since (new: greyed, with Add), then what I hid. */
export function resolveView(resources: readonly Resource[], view: ResourceView | undefined): ViewRow[] {
  const byId = new Map(resources.map((r) => [r.id, r]))
  const order = (view?.order ?? []).filter((id) => byId.has(id))
  const hidden = new Set(view?.hidden ?? [])
  const placed = new Set([...order, ...hidden])
  return [
    ...order.filter((id) => !hidden.has(id)).map((id): ViewRow => ({ item: byId.get(id)!, state: 'shown' })),
    ...resources.filter((r) => !placed.has(r.id)).map((item): ViewRow => ({ item, state: 'new' })),
    ...resources.filter((r) => hidden.has(r.id)).map((item): ViewRow => ({ item, state: 'hidden' })),
  ]
}

export const forkView = (from: ResourceView, owner: string): ResourceView => ({ owner, order: [...from.order], hidden: [...from.hidden], from: from.owner })

export function addToView(v: ResourceView, id: string): ResourceView {
  return { ...v, order: v.order.includes(id) ? v.order : [...v.order, id], hidden: v.hidden.filter((x) => x !== id) }
}

export function hideInView(v: ResourceView, id: string): ResourceView {
  return { ...v, order: v.order.filter((x) => x !== id), hidden: v.hidden.includes(id) ? v.hidden : [...v.hidden, id] }
}

export function moveInView(v: ResourceView, id: string, dir: -1 | 1): ResourceView {
  const i = v.order.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= v.order.length) return v
  const order = [...v.order]
  ;[order[i], order[j]] = [order[j], order[i]]
  return { ...v, order }
}

/** Adds a link to the shared list and to the end of my view; false for anything but an http(s) link. */
export function addResource(d: CommunityData, input: { title: string; url: string }, me: string, now: number): boolean {
  const url = safeUrl(input.url)
  if (!url) return false
  const id = `r${now.toString(36)}${(d.resources?.length ?? 0).toString(36)}`
  d.resources = [...(d.resources ?? []), { id, title: input.title.trim() || new URL(url).host, url, by: me, at: now }]
  d.mine = addToView(d.mine ?? { owner: me, order: [], hidden: [] }, id)
  return true
}

/** A published Google Doc (…/pub) on docs.google.com, with embedded=true; null for anything else. */
export function docsEmbedUrl(raw: string): string | null {
  const href = safeUrl(raw)
  if (!href) return null
  const u = new URL(href)
  if (u.protocol !== 'https:' || u.host !== 'docs.google.com' || !/\/pub$/.test(u.pathname)) return null
  u.search = '?embedded=true'
  return u.href
}

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'web.telegram.org'])

/** A Telegram link (https on t.me, telegram.me or web.telegram.org); a bare "t.me/x" gets https. Null for anything else. */
export function telegramUrl(raw: string): string | null {
  const t = raw.trim()
  const href = safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
  if (!href) return null
  const u = new URL(href)
  return u.protocol === 'https:' && TELEGRAM_HOSTS.has(u.host) ? u.href : null
}
