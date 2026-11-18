// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c community-resources: the scoped Resources / References list (three sections, General collapsed) and the tag chip row of an item. Logic: resource_scope.ts. */
import { el } from '../../demo/src/ui/dom'
import type { InventoryItem } from './model'
import { eventTagLabel, eventTagSlug } from './event_tag'
import { resourceList } from './resource_list'
import { addScoped, forPage, itemTags, markOpened, partitionScope, type EventTagRules, type Page, type Scope } from './resource_scope'
import { ageCompact } from './feed_row'
import { inlineEdit } from './membranes_five_view'
import { typedSource } from './provenance'
import { S } from './strings'

export const EVENT_TAG: EventTagRules = { slug: eventTagSlug, label: eventTagLabel }

type Tag = { id: string; label?: string; community?: boolean }
type Ev = { id: string; name: string; tagName?: string }

/** P3: General stays folded until asked, per view. */
let generalOpen = false

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
}

/** answers-44d: "shared by <name> · <age>" of one item: the sender of a received item (its id when unknown), null = me; `at` for the tooltip. */
export function sharedByLine(i: InventoryItem, nameOf: (id: string) => string | undefined, now: number): { name: string | null; age: string; at: number } {
  return { name: i.sharedBy ? nameOf(i.sharedBy) ?? i.sharedBy : null, age: ageCompact(i.createdAt, now), at: i.createdAt }
}

/** answers-44d: the personal "+ add" row (membranes_five_view.ts inlineEdit), here at the top of Shared by me, pre-tagged with the scope's tag. */
function addRow(c: ScopedCtx, newId: () => string): HTMLElement {
  const row = el('div', { class: 'meta card-res-row', 'data-rs-add-row': '' })
  const show = (): void => row.replaceChildren(el('button', { class: 'card-res-add', type: 'button', 'data-rs-add': '' }, [S.a44d.addResource]))
  const edit = (): void => row.replaceChildren(inlineEdit(S.a44d.addResource, '', 'data-rs-add-input', (typed) => {
    if (typed !== null && addScoped(c.items as InventoryItem[], c.scope, c.page, typed, newId(), Date.now(), typedSource())) { c.save(); c.render() } else show()
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
  const p = partitionScope(forPage(c.items, c.page), c.scope)
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
  const name = c.scope.label
  return [el('h3', { class: 'rs-title', 'data-rs-title': c.page }, [c.page === 'references' ? S.w44cr.refTitle(name) : S.w44cr.title(name)]),
    section('shared', S.w44cr.shared, p.shared), section('fresh', S.w44cr.fresh, p.fresh, true), general].filter((n): n is Node => n !== null)
}
