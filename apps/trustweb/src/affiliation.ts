// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard: affiliations = everything I belong to: communities, other groups (family lives here), events and tags. Each has a
 * Dashboard (members, requests, live now, a feed tile when the scope offers one). Derived from what the record holds; nothing new is stored
 * except the `group: 'otherGroup'` flag in a community's settings. Pure, no imports (apps/mcp loads it under plain node, so the event-tag rule eventTagSlug of event_tag.ts is handed in as `eventTag`).
 */
export type AffiliationKind = 'community' | 'otherGroup' | 'event' | 'tag'
/** event_tag.ts eventTagSlug: the colour tag every event is (P4). */
export type EventTag = (name: string) => string
export interface Affiliation { id: string; kind: AffiliationKind; name: string; members: number }

interface TagLike { id: string; label?: string; community?: boolean; system?: boolean }
interface PersonLike { id: string; peerId?: string; fields?: Record<string, unknown>; deleted_at?: unknown; blocked?: number }
interface EventLike { id: string; name: string; from: string; to?: string }
interface DataLike { meta?: Record<string, { group?: string } | undefined> }
interface AskLike { peerId: string }

const live = (people: readonly PersonLike[]): PersonLike[] => people.filter((p) => !p.deleted_at && !(p.blocked && p.blocked > 0))
const holds = (p: PersonLike, tag: string): boolean => String(p.fields?.[tag]) === 'true'

export function listAffiliations(i: { eventTag: EventTag; data: DataLike; tags: readonly TagLike[]; events?: readonly EventLike[]; people: readonly PersonLike[] }): Affiliation[] {
  const people = live(i.people)
  const count = (tag: string): number => people.filter((p) => holds(p, tag)).length
  const mk = (kind: AffiliationKind, t: TagLike): Affiliation => ({ id: `${kind === 'otherGroup' ? 'group' : kind}:${t.id}`, kind, name: t.label ?? t.id, members: count(t.id) })
  const tags = i.tags.filter((t) => t.system !== true)
  const kindOf = (t: TagLike): AffiliationKind => i.data.meta?.[t.id]?.group === 'otherGroup' ? 'otherGroup' : t.community === true || i.data.meta?.[t.id] ? 'community' : 'tag'
  const by = (k: AffiliationKind): Affiliation[] => tags.filter((t) => kindOf(t) === k).map((t) => mk(k, t))
  const events = (i.events ?? []).map((e): Affiliation => ({ id: `event:${e.id}`, kind: 'event', name: e.name, members: count(i.eventTag(e.name)) }))
  return [...by('community'), ...by('otherGroup'), ...events, ...by('tag')]
}

export const affiliationById = (list: readonly Affiliation[], id: string): Affiliation | undefined => list.find((a) => a.id === id)

/** The tag whose holders are the members: the colour tag itself, or the event's `event_<slug>` tag. */
export const memberTagOf = (a: Affiliation, events: readonly EventLike[], eventTag: EventTag): string => {
  const raw = a.id.slice(a.id.indexOf(':') + 1)
  return a.kind === 'event' ? eventTag(events.find((e) => e.id === raw)?.name ?? a.name) : raw
}

export type DashTile = 'members' | 'requests' | 'live' | 'feed'
export interface DashData { tiles: DashTile[]; members: number; requests: number; live: number }

const dayStart = (iso: string, end: boolean): number => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d + (end ? 1 : 0)).getTime() }
const onNow = (e: EventLike, now: number): boolean => dayStart(e.from, false) <= now && now < dayStart(e.to ?? e.from, true)

/** Members of the scope, asks to me from them (awayAsks), and "live now": my members of a community or group whose event runs now, or the event itself. */
export function dashboardOf(a: Affiliation, i: { eventTag: EventTag; people: readonly PersonLike[]; events?: readonly EventLike[]; awayAsks?: readonly AskLike[]; now: number; feed: boolean }): DashData {
  const tag = memberTagOf(a, i.events ?? [], i.eventTag)
  const members = live(i.people).filter((p) => holds(p, tag))
  const peers = new Set(members.map((p) => p.peerId).filter((x): x is string => !!x))
  const running = (i.events ?? []).filter((e) => onNow(e, i.now))
  return {
    tiles: ['members', 'requests', 'live', ...(i.feed ? ['feed' as const] : [])],
    members: members.length,
    requests: (i.awayAsks ?? []).filter((x) => peers.has(x.peerId)).length,
    live: a.kind === 'event' ? running.filter((e) => `event:${e.id}` === a.id).length : running.length,
  }
}

/** Managed or unmanaged is asked once, when a community or other group is created; events and tags have no such choice. */
export const kindChoiceOnCreate = (k: AffiliationKind): boolean => k === 'community' || k === 'otherGroup'
/** After creation it shows only in the settings of that community or group. */
export const managedSettingScope = (k: AffiliationKind): 'settings' | null => (kindChoiceOnCreate(k) ? 'settings' : null)

/** The "live now" mark flashes once when the screen opens (on = the CSS animation class is set), then stays still; a refresh press plays it again. */
export function createFlash(): { readonly on: boolean; ended: () => void; replay: () => void } {
  let on = true
  return { get on() { return on }, ended: () => { on = false }, replay: () => { on = true } }
}
