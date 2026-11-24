// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b resources-views (Tana B15, B16, B19, B20): several views of the Resources page, filters by kind / who shared / community, protected
 * resources (from a protected community: no share-on, no selection, link one at a time) and "recommended by" detection. Pure: no DOM, no storage.
 */
import type { AppState, InventoryItem, ResourceKind } from './model'
import type { ColourTag } from './colour_tags'
import { goneFromView } from './resource_scope' // wave46 iyg-reviewfix

export const RESOURCE_KINDS: readonly ResourceKind[] = ['book', 'publication', 'reference', 'recording', 'link', 'other']
export type ResourceView = 'list' | 'outliner' | 'person'
export const RESOURCE_VIEWS: readonly ResourceView[] = ['list', 'outliner', 'person']

/** Switch: a protected resource's link shows for one item at a time (revealNext). */
export const PROTECTED_LINK_ONE_AT_A_TIME = true

export interface ResourceFilter { kind?: ResourceKind; sharedBy?: string; communityId?: string }
type Tags = readonly Pick<ColourTag, 'id' | 'label'>[] & readonly { protected?: boolean }[]

export const kindOf = (i: Pick<InventoryItem, 'kind'>): ResourceKind => i.kind ?? 'other'

/** Protected = flagged itself, or it belongs to a community tag marked protected. */
export const isProtected = (i: Pick<InventoryItem, 'protected' | 'communityId'>, tags: readonly { id: string; protected?: boolean }[]): boolean =>
  Boolean(i.protected) || (i.communityId !== undefined && tags.some((t) => t.id === i.communityId && t.protected === true))

export const canShareOn = (i: Pick<InventoryItem, 'protected' | 'communityId'>, tags: readonly { id: string; protected?: boolean }[]): boolean => !isProtected(i, tags)

/** The selection model: select-all and copy-all see only these. */
export const selectableResources = <T extends Pick<InventoryItem, 'protected' | 'communityId'>>(items: readonly T[], tags: readonly { id: string; protected?: boolean }[]): T[] =>
  items.filter((i) => !isProtected(i, tags))

export const copyAllText = (items: readonly InventoryItem[], tags: readonly { id: string; protected?: boolean }[]): string => selectableResources(items, tags).map((i) => i.text).join('\n')

/** Which protected link shows after a press on `id`: that one, or none when it was the open one. */
export const revealNext = (current: string | null, id: string): string | null => revealLinks(current ? [current] : [], id, true)[0] ?? null

/** The protected links shown after a press on `id` (review 43b: the switch decides): it toggles; with PROTECTED_LINK_ONE_AT_A_TIME the others close. */
export function revealLinks(shown: readonly string[], id: string, oneAtATime: boolean = PROTECTED_LINK_ONE_AT_A_TIME): string[] {
  if (shown.includes(id)) return shown.filter((x) => x !== id)
  return oneAtATime ? [id] : [...shown, id]
}

/** B20: "start the recording immediately": Play opens a protected resource's own link (http or https only) without showing it. */
export function playUrl(i: Pick<InventoryItem, 'link'>): string | null {
  try {
    const u = new URL(i.link ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

export function filterResources<T extends InventoryItem>(items: readonly T[], f: ResourceFilter): T[] {
  return items.filter((i) => !goneFromView(i) && (!f.kind || kindOf(i) === f.kind) && (!f.sharedBy || i.sharedBy === f.sharedBy) && (!f.communityId || i.communityId === f.communityId))
}

/** "Suggested by others" = someone shared it with me; the rest is mine. */
export function splitSections<T extends InventoryItem>(items: readonly T[]): { mine: T[]; suggested: T[] } {
  return { mine: items.filter((i) => !i.sharedBy), suggested: items.filter((i) => Boolean(i.sharedBy)) }
}

export interface OutlinerCommunity { id: string; label: string; kinds: { kind: ResourceKind; items: InventoryItem[] }[] }

/** Community > kind > item; communities in the order first met, items without a community last (label ''). */
export function groupOutliner(items: readonly InventoryItem[], tags: readonly Pick<ColourTag, 'id' | 'label'>[]): OutlinerCommunity[] {
  const order: string[] = []
  for (const i of items) { const c = i.communityId ?? ''; if (!order.includes(c)) order.push(c) }
  order.sort((a, b) => Number(a === '') - Number(b === ''))
  return order.map((id) => {
    const inC = items.filter((i) => (i.communityId ?? '') === id)
    return {
      id, label: id ? tags.find((t) => t.id === id)?.label ?? id : '',
      kinds: RESOURCE_KINDS.filter((k) => inC.some((i) => kindOf(i) === k)).map((kind) => ({ kind, items: inC.filter((i) => kindOf(i) === kind) })),
    }
  })
}

/** Grouped by who shared it, else who recommended it; the rest under ''. */
export function groupByPerson(items: readonly InventoryItem[]): { person: string; items: InventoryItem[] }[] {
  const who = (i: InventoryItem): string => i.sharedBy ?? i.recommendedBy ?? ''
  const order: string[] = []
  for (const i of items) if (!order.includes(who(i))) order.push(who(i))
  order.sort((a, b) => Number(a === '') - Number(b === ''))
  return order.map((person) => ({ person, items: items.filter((i) => who(i) === person) }))
}

// ---- recommended-by detection (B19/B20): patterns, no LLM ----
const EXPLICIT = 'recommended(?: to me)? by|empfohlen von|recommand[ée]e? par|recomendad[oa] por|consigliat[oa] da|raccomandat[oa] da|indicad[oa] por'
const BARE = 'by|von|par|por|da'
const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface RecommenderGuess { personId: string; name: string; explicit: boolean }

/** A known person named after "recommended by" / "empfohlen von" / "by" / "von" … in `text`; none when that person is the item's author. */
export function detectRecommender(text: string, people: readonly { id: string; name: string }[], author?: string): RecommenderGuess | null {
  const t = norm(text)
  const a = author ? norm(author) : ''
  const firsts = people.map((p) => norm(p.name).split(' ')[0])
  let best: (RecommenderGuess & { at: number }) | null = null
  for (const [idx, p] of people.entries()) {
    const full = norm(p.name)
    if (!full || full === a) continue
    const names = [full, ...(firsts.filter((f) => f === firsts[idx]).length === 1 && firsts[idx].length >= 2 ? [firsts[idx]] : [])]
    for (const [explicit, preps] of [[true, EXPLICIT], [false, BARE]] as const) {
      for (const n of names) {
        const m = new RegExp(`(?:^|[^\\p{L}])(?:${preps})\\s+${esc(n)}(?![\\p{L}])`, 'u').exec(t)
        if (!m) continue
        if (!best || (explicit && !best.explicit) || (explicit === best.explicit && m.index < best.at)) best = { personId: p.id, name: p.name, explicit, at: m.index }
        break
      }
    }
  }
  return best ? { personId: best.personId, name: best.name, explicit: best.explicit } : null
}

// ---- changes (the app and MCP share these) ----
function itemOf(rec: Pick<AppState, 'inventory'>, id: string): InventoryItem {
  const i = rec.inventory.find((x) => x.id === id)
  if (!i) throw new Error(`no resource "${id}"`)
  return i
}

export function setKind(rec: Pick<AppState, 'inventory'>, id: string, kind: string): boolean {
  if (!(RESOURCE_KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of ${RESOURCE_KINDS.join(', ')}`)
  itemOf(rec, id).kind = kind as ResourceKind
  return true
}

/** Person id or free name; empty clears it. */
export function setRecommender(rec: Pick<AppState, 'inventory'>, id: string, who: string): boolean {
  const i = itemOf(rec, id)
  if (who.trim()) i.recommendedBy = who.trim(); else delete i.recommendedBy
  return true
}

export function acceptRecommender(rec: Pick<AppState, 'inventory'>, id: string, people: readonly { id: string; name: string }[]): string | null {
  const i = itemOf(rec, id)
  const g = detectRecommender(i.text, people)
  if (!g) return null
  i.recommendedBy = g.personId
  return g.personId
}

export function dismissRecommender(rec: Pick<AppState, 'inventory'>, id: string): boolean { itemOf(rec, id).recommenderDismissed = true; return true }

/** The chip's suggestion: none once decided (set or dismissed). */
export const suggestionFor = (i: InventoryItem, people: readonly { id: string; name: string }[]): RecommenderGuess | null =>
  i.recommendedBy || i.recommenderDismissed ? null : detectRecommender(i.text, people)

// ---- MCP read ----
export interface ListedResource { id: string; text: string; kind: ResourceKind; sharedBy?: string; recommendedBy?: string; communityId?: string; protected: boolean; link?: string }

export function listResources(items: readonly InventoryItem[], tags: readonly Pick<ColourTag, 'id' | 'label'>[] & Tags, f: ResourceFilter & { view?: string }): { items: ListedResource[]; groups: Record<string, unknown>[] } {
  const view = f.view ?? 'list'
  if (!(RESOURCE_VIEWS as readonly string[]).includes(view)) throw new Error(`view must be one of ${RESOURCE_VIEWS.join(', ')}`)
  const kept = filterResources(items, f)
  const row = (i: InventoryItem): ListedResource => {
    const prot = isProtected(i, tags)
    return { id: i.id, text: i.text, kind: kindOf(i), ...(i.sharedBy ? { sharedBy: i.sharedBy } : {}), ...(i.recommendedBy ? { recommendedBy: i.recommendedBy } : {}), ...(i.communityId ? { communityId: i.communityId } : {}), protected: prot, ...(i.link && !prot ? { link: i.link } : {}) }
  }
  const groups = view === 'outliner' ? groupOutliner(kept, tags).map((c) => ({ id: c.id, label: c.label, kinds: c.kinds.map((k) => ({ kind: k.kind, items: k.items.map(row) })) }))
    : view === 'person' ? groupByPerson(kept).map((g) => ({ person: g.person, items: g.items.map(row) })) : []
  return { items: kept.map(row), groups }
}
