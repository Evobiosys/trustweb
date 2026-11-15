// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views: the Resources page's view switcher (List, Outliner, By person), filters, the two top sections and protected rows. Logic: resource_views.ts. */
import { el } from '../../demo/src/ui/dom'
import type { ColourTag } from './colour_tags'
import type { InventoryItem, ResourceKind } from './model'
import {
  RESOURCE_KINDS, RESOURCE_VIEWS, filterResources, groupByPerson, groupOutliner, isProtected, kindOf, playUrl, revealLinks, setKind, acceptRecommender, dismissRecommender, splitSections, suggestionFor,
} from './resource_views'
import type { ResourceFilter, ResourceView } from './resource_views'
import { S } from './strings'

export interface ResourceViewsCtx {
  items: readonly InventoryItem[]
  people: readonly { id: string; name: string; deleted_at?: string }[]
  tags: readonly ColourTag[]
  /** The usual list row (audience, switch, remove) of an unprotected resource in the List view. */
  row: (i: InventoryItem) => Node
  open: (id: string) => void
  record: (i: InventoryItem) => void
  /** B20: starts a protected recording (opens its link) without showing the link. */
  play: (url: string) => void
  save: () => void
  render: () => void
}

let view: ResourceView = 'list'
let filter: ResourceFilter = {}
let revealed: string[] = []
let filtersOpen = false

const noSelect = (n: HTMLElement): HTMLElement => { n.addEventListener('selectstart', (e) => e.preventDefault()); n.addEventListener('copy', (e) => e.preventDefault()); return n }

export function resourceViews(c: ResourceViewsCtx): Node[] {
  const name = (id: string): string => c.people.find((p) => p.id === id)?.name ?? id
  const label = (id: string): string => c.tags.find((t) => t.id === id)?.label ?? id
  const set = (f: ResourceFilter): void => { filter = f; revealed = []; c.render() }
  const pressed = (on: boolean, attrs: Record<string, string>, text: string, click: () => void): HTMLElement =>
    el('button', { class: 'btn btn-ghost btn-sm' + (on ? '' : ' tw-off'), 'aria-pressed': String(on), ...attrs, onclick: click }, [text])

  const switcher = el('div', { class: 'rv-switch', role: 'group', 'aria-label': S.resViews.viewsAria }, RESOURCE_VIEWS.map((v) =>
    pressed(view === v, { 'data-rv-view': v }, S.resViews.view[v], () => { view = v; revealed = []; c.render() })))
  const sharers = [...new Set(c.items.map((i) => i.sharedBy).filter((x): x is string => Boolean(x)))]
  const communities = [...new Set(c.items.map((i) => i.communityId).filter((x): x is string => Boolean(x)))]
  const kindChips = el('div', { class: 'rv-chips' }, [
    pressed(!filter.kind, { 'data-rv-kind': '' }, S.resViews.all, () => set({ ...filter, kind: undefined })),
    ...RESOURCE_KINDS.map((k) => pressed(filter.kind === k, { 'data-rv-kind': k }, S.resViews.kind[k], () => set({ ...filter, kind: filter.kind === k ? undefined : k }))),
  ])
  const shared = sharers.length === 0 ? null : el('select', { class: 'field rv-shared', 'data-rv-shared': '', 'aria-label': S.resViews.sharedBy, onchange: (e: Event) => set({ ...filter, sharedBy: (e.target as HTMLSelectElement).value || undefined }) }, [
    el('option', { value: '' }, [S.resViews.anyone]), ...sharers.map((id) => el('option', { value: id, ...(filter.sharedBy === id ? { selected: '' } : {}) }, [name(id)])),
  ])
  const comm = communities.length === 0 ? null : el('div', { class: 'rv-chips' }, communities.map((id) =>
    pressed(filter.communityId === id, { 'data-rv-community': id }, label(id), () => set({ ...filter, communityId: filter.communityId === id ? undefined : id }))))

  const items = filterResources(c.items, filter)
  const chipsOf = (i: InventoryItem): HTMLElement => el('div', { class: 'cal-chips' }, [
    el('span', { class: 'cal-chip' }, [S.resViews.kind[kindOf(i)]]),
    i.communityId ? el('span', { class: 'cal-chip' }, [label(i.communityId)]) : null,
    i.sharedBy ? el('span', { class: 'cal-chip' }, [S.resViews.sharedByName(name(i.sharedBy))]) : i.recommendedBy ? el('span', { class: 'cal-chip' }, [S.resViews.recommendedByName(name(i.recommendedBy))]) : null,
  ])
  const compact = (i: InventoryItem): HTMLElement => el('button', { class: 'prow zoom-row', 'data-item': i.id, onclick: () => c.open(i.id) }, [el('b', {}, [i.text]), chipsOf(i)])

  const protectedRow = (i: InventoryItem): HTMLElement => {
    const open = revealed.includes(i.id)
    const url = playUrl(i)
    return noSelect(el('div', { class: 'prow zoom-row rv-protected', 'data-rv-protected': i.id, oncontextmenu: (e: Event) => e.preventDefault() }, [
      el('b', {}, [i.text]),
      el('div', { class: 'cal-chips' }, [el('span', { class: 'cal-chip' }, [S.resViews.protectedChip]), el('span', { class: 'cal-chip' }, [S.resViews.kind[kindOf(i)]])]),
      el('div', { class: 'rv-actions' }, [
        // B20 review 43b: "start the recording immediately" = play it, link unseen; Record (a memo about it) stays as built, see D-line.
        url ? el('button', { class: 'btn btn-ghost btn-sm', 'data-rv-play': i.id, onclick: () => c.play(url) }, [S.resViews.play]) : null,
        i.link ? el('button', { class: 'btn btn-ghost btn-sm', 'data-rv-link-toggle': i.id, 'aria-expanded': String(open), onclick: () => { revealed = revealLinks(revealed, i.id); c.render() } }, [open ? S.resViews.hideLink : S.resViews.showLink]) : null,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-rv-record': i.id, 'aria-label': S.resViews.record, onclick: () => c.record(i) }, [S.resViews.record]),
      ]),
      i.link && open ? el('div', { class: 'rv-link', 'data-rv-link': i.id }, [i.link]) : null,
    ]))
  }

  const suggestion = (i: InventoryItem): HTMLElement | null => {
    const g = suggestionFor(i, c.people.filter((p) => p.deleted_at === undefined))
    if (!g) return null
    return el('div', { class: 'rv-suggest', 'data-rv-suggest': i.id }, [
      el('span', { class: 'cal-chip' }, [S.resViews.recommendedQ(g.name)]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-rv-accept': i.id, onclick: () => { acceptRecommender({ inventory: [...c.items] }, i.id, c.people); c.save(); c.render() } }, [S.resViews.accept]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-rv-dismiss': i.id, onclick: () => { dismissRecommender({ inventory: [...c.items] }, i.id); c.save(); c.render() } }, [S.resViews.dismiss]),
    ])
  }
  const kindSelect = (i: InventoryItem): HTMLElement => el('select', { class: 'rv-kind-set', 'data-rv-kind-set': i.id, 'aria-label': S.resViews.kindAria, onchange: (e: Event) => { setKind({ inventory: [...c.items] }, i.id, (e.target as HTMLSelectElement).value); c.save(); c.render() } },
    RESOURCE_KINDS.map((k: ResourceKind) => el('option', { value: k, ...(kindOf(i) === k ? { selected: '' } : {}) }, [S.resViews.kind[k]])))
  const rowFor = (i: InventoryItem): Node => isProtected(i, c.tags)
    ? protectedRow(i)
    : el('div', { class: 'rv-item', 'data-rv-item': i.id }, [view === 'list' ? c.row(i) : compact(i), el('div', { class: 'rv-meta' }, [kindSelect(i)]), suggestion(i)])

  const section = (key: string, title: string, list: readonly InventoryItem[]): Node => el('section', { class: 'rv-section', 'data-rv-section': key }, [el('h3', {}, [title]), ...list.map(rowFor)])
  let body: Node[]
  if (items.length === 0) body = c.items.length ? [el('p', { class: 'empty' }, [S.resViews.none])] : []
  else if (view === 'outliner') {
    body = groupOutliner(items, c.tags).map((g) => el('section', { class: 'rv-section', 'data-rv-community-group': g.id }, [
      el('h3', {}, [g.label || S.resViews.noCommunity]),
      ...g.kinds.map((k) => el('div', { class: 'rv-indent', 'data-rv-kind-group': k.kind }, [el('h4', {}, [S.resViews.kind[k.kind]]), ...k.items.map(rowFor)])),
    ]))
  } else if (view === 'person') {
    body = groupByPerson(items).map((g) => el('section', { class: 'rv-section', 'data-rv-person-group': g.person }, [el('h3', {}, [g.person ? name(g.person) : S.resViews.nobody]), ...g.items.map(rowFor)]))
  } else {
    const s = splitSections(items)
    body = [section('mine', S.resViews.mine, s.mine), ...(s.suggested.length ? [section('suggested', S.resViews.suggested, s.suggested)] : [])]
  }
  // P3: the filters sit behind a V expander; they stay open while one is on.
  const open = filtersOpen || Boolean(filter.kind || filter.sharedBy || filter.communityId)
  const toggle = el('button', { class: 'btn btn-ghost btn-sm rv-filters-toggle', 'data-rv-filters-toggle': '', 'aria-expanded': String(open), onclick: () => { filtersOpen = !open; c.render() } }, [S.resViews.filters + (open ? ' ⌃' : ' ⌄')])
  return [el('div', { class: 'rv-bar', 'data-resource-views': view }, [el('div', { class: 'rv-head' }, [switcher, toggle]), ...(open ? [kindChips, shared, comm] : [])]), ...body]
}
