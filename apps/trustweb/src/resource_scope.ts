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
  const ev = i.eventId ? events.find((e) => e.id === i.eventId) : undefined
  if (ev) add(`event:${ev.id}`, et.label(evName(ev)))
  return out
}

const carries = (i: InventoryItem, sc: Scope): boolean =>
  sc.kind === 'event' ? i.eventId === sc.id || (i.tagAudience ?? []).some((t) => sc.tagIds?.includes(t)) : i.communityId === sc.id || (i.tagAudience ?? []).includes(sc.id)

export function partitionScope(items: readonly InventoryItem[], sc: Scope): Sections {
  const tagged = items.filter((i) => carries(i, sc))
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
