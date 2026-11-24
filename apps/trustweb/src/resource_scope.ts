// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c community-resources: Resources and References scoped to one community (its colour tag) or one event (event mode), in three sections:
 * "Shared by me" (mine, or already opened, carrying the tag), "New, shared with me" (received, not yet opened, newest first) and "General"
 * (my other resources, shown collapsed). Also the tag chips of an item. Pure, no runtime imports (apps/mcp loads it under plain node:
 * the event-tag rules of event_tag.ts are handed in as `et`).
 */
import type { AppState, InventoryItem, TwEvent } from './model'

export interface EventTagRules { slug: (name: string) => string; label: (name: string) => string }
type Tag = { id: string; label?: string; community?: boolean }
type Ev = Pick<TwEvent, 'id' | 'name' | 'tagName'>
const evName = (e: Ev): string => e.tagName ?? e.name

/** What the list is narrowed to: tagIds = every tag id on an item that counts as "carries it". */
export interface Scope { kind: 'community' | 'event'; id: string; label: string; tagIds?: string[] }
export interface Sections { shared: InventoryItem[]; fresh: InventoryItem[]; general: InventoryItem[] }

/** Event mode wins; else exactly one community chip in `show`; else null (the bare community chip and plain tags do not scope). */
export function scopeOf(s: Pick<AppState, 'uiRings'>, tags: readonly Tag[], events: readonly Ev[], et: EventTagRules): Scope | null {
  const mode = s.uiRings?.eventMode
  const ev = mode ? events.find((e) => e.id === mode) : undefined
  if (ev) return { kind: 'event', id: ev.id, label: et.label(evName(ev)), tagIds: [et.slug(evName(ev))] }
  const chips = (s.uiRings?.show ?? []).filter((c) => c.startsWith('tag:') && tags.some((t) => t.id === c.slice(4) && t.community === true))
  const tag = chips.length === 1 ? tags.find((t) => t.id === chips[0].slice(4)) : undefined
  return tag ? { kind: 'community', id: tag.id, label: tag.label ?? tag.id } : null
}

/** Every tag on an item as chips: its selected tags, its community and its event, once each; ids nobody knows are skipped. */
export function itemTags(i: InventoryItem, tags: readonly Tag[], events: readonly Ev[], et: EventTagRules): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  const add = (id: string, label: string | undefined): void => { if (label !== undefined && !out.some((t) => t.id === id)) out.push({ id, label }) }
  for (const id of [...(i.tagAudience ?? []), ...(i.communityId ? [i.communityId] : [])]) { const t = tags.find((x) => x.id === id); add(id, t && (t.label ?? t.id)) }
  for (const eid of i.eventIds ?? (i.eventId ? [i.eventId] : [])) { const ev = events.find((e) => e.id === eid); if (ev) add(`event:${ev.id}`, et.label(evName(ev))) } // wave46: one resource in several events
  return out
}

const carries = (i: InventoryItem, sc: Scope): boolean =>
  sc.kind === 'event' ? i.eventId === sc.id || (i.eventIds ?? []).includes(sc.id) || (i.tagAudience ?? []).some((t) => sc.tagIds?.includes(t)) : i.communityId === sc.id || (i.tagAudience ?? []).includes(sc.id)

/** wave46 iyg-reviewfix F4/F5: a received item that is retracted by its author or hidden by me: out of every view (never deleted). */
export const goneFromView = (i: Pick<InventoryItem, 'sharedBy' | 'retractedAt' | 'hidden'>): boolean => !!i.sharedBy && (i.retractedAt !== undefined || i.hidden === true)

export function partitionScope(items: readonly InventoryItem[], sc: Scope): Sections {
  const tagged = items.filter((i) => carries(i, sc) && !goneFromView(i)) // wave46: a retracted or hidden received item is out
  return {
    shared: tagged.filter((i) => !i.sharedBy || i.openedAt !== undefined),
    fresh: tagged.filter((i) => i.sharedBy && i.openedAt === undefined).sort((a, b) => b.createdAt - a.createdAt),
    general: items.filter((i) => !i.sharedBy && !carries(i, sc)),
  }
}

export type Page = 'resources' | 'references'
/** References = kind reference; Resources = everything else. */
export const forPage = <T extends Pick<InventoryItem, 'kind'>>(items: readonly T[], page: Page): T[] => items.filter((i) => (i.kind === 'reference') === (page === 'references'))

/** First open of a received item: stamps `openedAt` (it leaves "New"). False when unknown or already opened. */
export function markOpened(items: readonly InventoryItem[], id: string, now: number): boolean {
  const i = items.find((x) => x.id === id)
  if (!i || i.openedAt !== undefined) return false
  i.openedAt = now
  return true
}

/** MCP: resources_list scope. 'mine' (or none) = no narrowing: null. community / event need their id; the answer lists ids per section. */
export function scopedList(items: readonly InventoryItem[], tags: readonly Tag[], events: readonly Ev[], et: EventTagRules, q: { scope?: string; community?: string; event?: string }): { title: string; sections: Record<'shared' | 'new' | 'general', string[]> } | null {
  if (!q.scope || q.scope === 'mine') return null
  let sc: Scope
  if (q.scope === 'community') {
    const t = tags.find((x) => x.id === q.community)
    if (!t) throw new Error('community: give the id of a community')
    sc = { kind: 'community', id: t.id, label: t.label ?? t.id }
  } else if (q.scope === 'event') {
    const e = events.find((x) => x.id === q.event)
    if (!e) throw new Error('event: give the id of an event')
    sc = { kind: 'event', id: e.id, label: et.label(evName(e)), tagIds: [et.slug(evName(e))] }
  } else throw new Error('scope must be one of community, mine, event')
  const p = partitionScope(items, sc)
  const ids = (l: readonly InventoryItem[]): string[] => l.map((i) => i.id)
  return { title: sc.label, sections: { shared: ids(p.shared), new: ids(p.fresh), general: ids(p.general) } }
}

/* wave44c answers-44d */
/** resource_edit.ts RESOURCE_TITLE_MAX (this file stays free of runtime imports). */
const TITLE_MAX = 120
/** The tag a new item of this scope carries: the community's tag, or the event's tag (event_<slug>). */
export const scopeTag = (sc: Scope): string => (sc.kind === 'community' ? sc.id : sc.tagIds?.[0] ?? sc.id)

/**
 * "+ Add resource" of a scoped Resources / References view (and MCP resource_add): a typed item carrying the scope's tag, seen only by that tag
 * (resource_edit.ts categoryAudience for a tag: rings closed, I9), a reference on the References page. Null for an empty title.
 */
export function addScoped(items: InventoryItem[], sc: Scope, page: Page, title: string, id: string, now: number, source: InventoryItem['source']): InventoryItem | null {
  const text = title.trim().slice(0, TITLE_MAX)
  if (!text) return null
  const item = { id, text, audience: 'me', included: true, createdAt: now, source, tagAudience: [scopeTag(sc)], ...(page === 'references' ? { kind: 'reference' } : {}) } as InventoryItem
  items.push(item)
  return item
}

/* wave45 resource-event-private */
/** The events made in / shared with a community (colour tag id), for the "visible to" pick of its add row. */
export const communityEvents = <E extends Ev & { communityId?: string; community?: string }>(events: readonly E[], communityId: string): E[] => events.filter((e) => (e.communityId ?? e.community) === communityId)

/**
 * Kept private to ONE event: the event's tag only (so only people holding it are answered, rings closed, I9), tied to the event and to its community
 * (it lists in that community's Resources for me; a member without the event tag is never answered, so sees no trace). Null for an empty title.
 */
export function addEventPrivate(items: InventoryItem[], ev: Ev & { communityId?: string; community?: string }, et: EventTagRules, page: Page, title: string, id: string, now: number, source: InventoryItem['source']): InventoryItem | null {
  const item = addScoped(items, { kind: 'event', id: ev.id, label: et.label(evName(ev)), tagIds: [et.slug(evName(ev))] }, page, title, id, now, source)
  if (!item) return null
  item.eventId = ev.id
  const community = ev.communityId ?? ev.community
  if (community) item.communityId = community
  return item
}

/* wave46 iyg-shared-resource */
/**
 * "Add for the event and its community": ONE item in the community and in these events (of that community; the first is `eventId`), seen by the
 * community's members and the events' people (their tags, rings closed, I9), `synced` (resource_sync.ts sends it and every edit). Null for an empty
 * title or events without a community.
 */
export function addBoth(items: InventoryItem[], evs: readonly (Ev & { communityId?: string; community?: string })[], et: EventTagRules, page: Page, title: string, id: string, now: number, source: InventoryItem['source']): InventoryItem | null {
  const community = evs[0]?.communityId ?? evs[0]?.community
  if (!community || !evs.every((e) => (e.communityId ?? e.community) === community)) return null
  const item = addScoped(items, { kind: 'community', id: community, label: community }, page, title, id, now, source)
  if (!item) return null
  item.tagAudience = [community, ...evs.map((e) => et.slug(evName(e)))]
  item.eventId = evs[0].id
  item.eventIds = evs.map((e) => e.id)
  item.communityId = community
  item.synced = true
  item.updatedAt = now
  return item
}

/* wave46 iyg-assemble (G1) */
/** Edit title and link of my own synced resource; false (nothing changed) for a received item, an empty title or a link that is not https. Empty link = none. */
export function editSynced(items: readonly InventoryItem[], id: string, title: string, link: string): boolean {
  const item = items.find((i) => i.id === id)
  const text = title.trim().slice(0, TITLE_MAX)
  const url = link.trim()
  if (!item || !item.synced || item.sharedBy || !text || (url && !/^https:\/\//i.test(url))) return false
  try { if (url) new URL(url) } catch { return false }
  item.text = text
  if (url) item.link = url; else delete item.link
  return true
}

/* wave46 iyg-reviewfix (F4) */
/** Hide a resource somebody else shared: local flag only; false for my own item or an unknown id. */
export function hideReceived(items: readonly InventoryItem[], id: string): boolean {
  const item = items.find((i) => i.id === id)
  if (!item?.sharedBy) return false
  item.hidden = true
  return true
}

/* wave46 iyg-reviewfix (F6) */
/** The one line a synced item shows instead of audience controls: its community and its events, as the caller words it. */
export function sharedWithLine(i: Pick<InventoryItem, 'communityId' | 'eventIds' | 'eventId'>, community: (tag: string) => string, eventName: (id: string) => string, say: (community: string, events: string) => string): string {
  const ids = i.eventIds ?? (i.eventId ? [i.eventId] : [])
  return say(community(i.communityId ?? ''), ids.map(eventName).filter(Boolean).join(', '))
}

/** Remove = retract: switches my own synced item off; the next save tells everyone (resource_sync.ts). False for anything else. */
export function retractSynced(items: readonly InventoryItem[], id: string): boolean {
  const item = items.find((i) => i.id === id)
  if (!item?.synced || item.sharedBy) return false
  item.included = false
  return true
}
