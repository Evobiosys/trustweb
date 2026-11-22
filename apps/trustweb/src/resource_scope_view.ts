// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c community-resources: the scoped Resources / References list (three sections, General collapsed) and the tag chip row of an item. Logic: resource_scope.ts. */
import { el } from '../../demo/src/ui/dom'
import type { InventoryItem } from './model'
import { eventTagLabel, eventTagSlug } from './event_tag'
import { resourceList } from './resource_list'
import { addEventPrivate, addScoped, communityEvents, forPage, itemTags, markOpened, partitionScope, type EventTagRules, type Page, type Scope } from './resource_scope'
import { ageCompact } from './feed_row'
import { inlineEdit } from './membranes_five_view'
import { typedSource } from './provenance'
import { S } from './strings'
import { NOTION_VIEWS, scopeKey, scopeLabelOf, viewPrefs } from './resource_notion'
import type { ResViews } from './resource_notion'
import { arrangedItems, notionBody, viewPills, viewTools } from './resource_notion_view'
import type { NotionCtx } from './resource_notion_view'

export const EVENT_TAG: EventTagRules = { slug: eventTagSlug, label: eventTagLabel }

type Tag = { id: string; label?: string; community?: boolean }
type Ev = { id: string; name: string; tagName?: string; communityId?: string; community?: string }

/** P3: General stays folded until asked, per view. */
let generalOpen = false
/** Wave 45: the sort / tag filter of a scoped view, behind its V expander (P3). */
let toolsOpen = false
const memory: { resViews?: ResViews } = {}

export interface ScopedCtx {
  items: readonly InventoryItem[]
  tags: readonly Tag[]
  events: readonly Ev[]
  scope: Scope
  page: Page
  /** Opens the item's own sheet. */
  open: (id: string) => void
  save: () => void
  render: () => void
  /** answers-44d: the title emoji is on (title_emoji.ts emojiOn). */
  emoji?: boolean
  /** answers-44d: a person id -> name (the sender of a received item); and the id of a new item ("+ Add resource"; absent: no add row). */
  nameOf?: (id: string) => string | undefined
  newId?: () => string
  /** wave45 event-back-button: the in-app Back before the title; absent: none. */
  back?: () => void
  /** Wave 45 resources-notion-views: the app state (its resViews keeps view, filter and sort per scope); absent: kept in memory. */
  state?: { resViews?: ResViews }
  /** The item's attached picture (Gallery). */
  image?: (id: string) => Promise<Blob | null>
}

/** answers-44d: "shared by <name> · <age>" of one item: the sender of a received item (its id when unknown), null = me; `at` for the tooltip. */
export function sharedByLine(i: InventoryItem, nameOf: (id: string) => string | undefined, now: number): { name: string | null; age: string; at: number } {
  return { name: i.sharedBy ? nameOf(i.sharedBy) ?? i.sharedBy : null, age: ageCompact(i.createdAt, now), at: i.createdAt }
}

/** answers-44d: the personal "+ add" row (membranes_five_view.ts inlineEdit), here at the top of Shared by me, pre-tagged with the scope's tag. */
function addRow(c: ScopedCtx, newId: () => string): HTMLElement {
  const row = el('div', { class: 'meta card-res-row', 'data-rs-add-row': '' })
  const show = (): void => row.replaceChildren(el('button', { class: 'card-res-add', type: 'button', 'data-rs-add': '' }, [S.a44d.addResource]))
  /* wave45 resource-event-private: in a community, "Visible to" the whole community or only one of its events (P7: a small optional pick). */
  const evs = c.scope.kind === 'community' ? communityEvents(c.events, c.scope.id) : []
  const pick = evs.length === 0 ? null : el('select', { class: 'field meta', 'data-rs-add-audience': '', 'aria-label': S.w45rep.visibleTo }, [
    el('option', { value: '' }, [S.w45rep.wholeCommunity]), ...evs.map((e) => el('option', { value: e.id }, [S.w45rep.onlyEvent(EVENT_TAG.label(e.tagName ?? e.name))]))])
  const edit = (): void => row.replaceChildren(...(pick ? [pick] : []), inlineEdit(S.a44d.addResource, '', 'data-rs-add-input', (typed) => {
    const ev = evs.find((e) => e.id === (pick as HTMLSelectElement | null)?.value)
    const made = typed === null ? null : ev
      ? addEventPrivate(c.items as InventoryItem[], ev, EVENT_TAG, c.page, typed, newId(), Date.now(), typedSource())
      : addScoped(c.items as InventoryItem[], c.scope, c.page, typed, newId(), Date.now(), typedSource())
    if (made) { c.save(); c.render() } else show()
  }))
  row.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-rs-add]')) edit() })
  show()
  return row
}

/** The chips of one item; a tap hands its tag id and label to `pick`. Null when it carries no tag. */
export function tagRow(i: InventoryItem, tags: readonly Tag[], events: readonly Ev[], pick: (id: string, label: string) => void): HTMLElement | null {
  const chips = itemTags(i, tags, events, EVENT_TAG)
  return chips.length ? el('div', { class: 'cal-chips rs-tags', 'data-item-tags': i.id }, chips.map((t) =>
    el('button', { class: 'cal-chip rs-tag', type: 'button', 'data-tag-chip': t.id, 'aria-label': S.w44cr.tagFilter(t.label), onclick: () => pick(t.id, t.label) }, [t.label]))) : null
}

export function scopedResources(c: ScopedCtx): Node[] {
  const now = Date.now()
  // Wave 45: List keeps its sections; Table, Board and Gallery show the scope's own items (Shared by me + New). Filter and sort per view.
  const inPage = forPage(c.items, c.page)
  const scoped = (({ shared, fresh }) => [...shared, ...fresh])(partitionScope(inPage, c.scope))
  const nc: NotionCtx = {
    state: c.state ?? memory, key: scopeKey(c.scope, c.page), items: scoped, save: c.save, render: c.render, image: c.image, hideLink: (i) => i.protected === true,
    open: (id) => { if (markOpened(c.items, id, Date.now())) c.save(); c.open(id) },
    tagsOf: (i) => itemTags(i, c.tags, c.events, EVENT_TAG), nameOf: (id) => c.nameOf?.(id), scopeOf: (i) => scopeLabelOf(i, c.tags, c.events, EVENT_TAG),
  }
  const vp = viewPrefs(nc.state, nc.key)
  const isOpen = toolsOpen || Boolean(vp.filter.tag)
  const bar = el('div', { class: 'rv-bar', 'data-nv-bar': nc.key }, [
    el('div', { class: 'rv-head' }, [viewPills(nc, NOTION_VIEWS), el('button', { class: 'btn btn-ghost btn-sm rv-filters-toggle', type: 'button', 'data-nv-tools-toggle': '', 'aria-expanded': String(isOpen), onclick: () => { toolsOpen = !isOpen; c.render() } }, [S.resViews.filters + (isOpen ? ' ⌃' : ' ⌄')])]),
    ...(isOpen ? viewTools(nc) : []),
  ])
  const titleEl = el('h3', { class: 'rs-title', 'data-rs-title': c.page }, [c.page === 'references' ? S.w44cr.refTitle(c.scope.label) : S.w44cr.title(c.scope.label)])
  const head = c.back ? el('div', { class: 'rs-head' }, [el('button', { class: 'back', type: 'button', 'aria-label': S.back, 'data-rs-back': '', onclick: c.back }, ['‹']), titleEl]) : titleEl // wave45 event-back-button
  const notion = notionBody(nc)
  if (notion) return [head, bar, ...notion]
  const p = partitionScope(arrangedItems({ ...nc, items: inPage }), c.scope)
  const list = (key: string, rows: readonly InventoryItem[]): Node => el('div', { 'data-rs-list': key }, [resourceList('mine', rows.map((i) => ({
    id: i.id, title: i.text, at: i.createdAt, emoji: c.emoji, ...(c.nameOf ? { by: sharedByLine(i, c.nameOf, now) } : {}), chips: itemTags(i, c.tags, c.events, EVENT_TAG).map((t) => t.label),
    onOpen: () => { if (markOpened(c.items, i.id, Date.now())) c.save(); c.open(i.id) },
  })), now)])
  const section = (key: string, title: string, rows: readonly InventoryItem[], badge = false): Node | null => rows.length === 0 && key !== 'shared' ? null : el('section', { class: 'rv-section', 'data-rs-section': key }, [
    el('h3', {}, [title, badge ? el('span', { class: 'rs-badge', 'data-rs-badge': '' }, [String(rows.length)]) : null]),
    key === 'shared' && c.newId ? addRow(c, c.newId) : null,
    rows.length ? list(key, rows) : el('p', { class: 'empty' }, [S.w44cr.none]),
  ])
  const general = p.general.length === 0 ? null : el('section', { class: 'rv-section', 'data-rs-section': 'general' }, [
    el('button', { class: 'btn btn-ghost btn-sm rv-filters-toggle', 'data-rs-general-toggle': '', 'aria-expanded': String(generalOpen), onclick: () => { generalOpen = !generalOpen; c.render() } }, [`${S.w44cr.general} (${p.general.length})${generalOpen ? ' ⌃' : ' ⌄'}`]),
    generalOpen ? list('general', p.general) : null,
  ])
  return [head, bar,
    section('shared', S.w44cr.shared, p.shared), section('fresh', S.w44cr.fresh, p.fresh, true), general].filter((n): n is Node => n !== null)
}
