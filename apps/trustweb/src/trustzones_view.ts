// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (trustzones.ts): the pieces the TrustZones screen draws besides the rings: the outliner triangle, the zone panel (filter, pinned, one folding list per zone), the zzz strip, the legend. */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { type ColourTag, saveColourTags } from './colour_tags'
import { renamedTo } from './card_name'
import { HELLO_NAME_MAX } from './hello'
import { pinnedModeOf, pinnedOrder } from './membranes_five'
import { candidates, initial, withChip, withoutChip } from './share_page'
import { createPerson, createTag, suggestOrCreate, tagPerson, untagPerson } from './tag_create'
import type { CreateRow } from './tag_create'
import type { ChipRow } from './share_page'
import type { AppState, Person, Ring } from './model'
import { S } from './strings'
import { tapEdit } from './tap_edit'
import { FILTER_RINGS, ringShown, setRingShown } from './rings_filter'
import { TONE_ORDER, communityOf, communityTags, filterOpen, openRings, setUi, toggleRing, toneVar, zoneFor } from './trustzones'
import type { MoveKind } from './trustzones'
import { connectionsShown } from './zone_connections'

/** The one outliner glyph (G2): a triangle pointing right while folded, down while unfolded. */
export const triangle = (open: boolean): string => (open ? '▾' : '▸')

/** A fold control: the triangle, `label` for screen readers. Extra attributes (data-*, class) ride along. */
export function outlinerToggle(open: boolean, label: string, onToggle: (btn: HTMLElement) => void, attrs: Record<string, string> = {}): HTMLElement {
  const b = el('button', { type: 'button', 'aria-expanded': String(open), 'aria-label': label, title: label, ...attrs, class: 'outliner-toggle ' + (attrs.class ?? ''), onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); onToggle(b) } }, [triangle(open)])
  return b
}

export interface ZonePanelDeps {
  s: AppState
  /** Everyone the zones show (trustzones.ts inZones). */
  people: readonly Person[]
  tags: readonly ColourTag[]
  /** The name as shown. */
  nameOf: (p: Person) => string
  onOpen: (id: string) => void
  /** A renamed person: the caller stores it and redraws. */
  onRename: (p: Person, next: string) => void
  /** A view setting changed (already written to s.uiRings): save and redraw. */
  onChange: () => void
}

function row(d: ZonePanelDeps, p: Person, pinned: boolean): HTMLElement {
  const name = el('span', { class: 'zone-name' })
  tapEdit(name, {
    text: d.nameOf(p), value: p.name, aria: S.zoneRename(p.name), attrs: { 'data-zone-name-edit': p.id },
    maxlength: HELLO_NAME_MAX, resolve: (typed) => renamedTo(p.name, typed), commit: (next) => d.onRename(p, next),
  })
  return el('div', { class: 'zone-row' + (pinned ? ' pinned' : ''), 'data-zone-row': p.id, style: `--tone:${toneVar(zoneFor(p, communityOf(d.s)))}` }, [
    name,
    el('button', { class: 'btn btn-ghost btn-sm', 'data-zone-open': p.id, 'aria-label': p.name, onclick: () => d.onOpen(p.id) }, ['›']),
  ])
}

/** Filter (advanced): one checkbox per trust ring, Community tag. Wave 28b: drawn in the Network view (the TrustZones sidebar has the tag filters instead). */
export function filterSection(d: Pick<ZonePanelDeps, 's' | 'tags' | 'onChange'>): HTMLElement {
  const open = filterOpen(d.s)
  const check = (ring: Ring): HTMLElement => el('label', { class: 'zone-check' }, [
    el('input', { type: 'checkbox', 'data-zone-filter': ring, ...(ringShown(d.s, ring) ? { checked: '' } : {}), onchange: (e: Event) => { setRingShown(d.s, ring, (e.target as HTMLInputElement).checked); d.onChange() } }),
    ' ', S.ringLabel[ring],
  ])
  const community = communityOf(d.s)
  const pick = el('select', { class: 'field', 'data-zone-community': '', 'aria-label': S.zoneCommunity, onchange: (e: Event) => { setUi(d.s, 'community', (e.target as HTMLSelectElement).value || undefined); d.onChange() } }, [
    el('option', { value: '' }, [S.zoneCommunityNone]),
    ...communityTags(d.tags).map((t) => el('option', { value: t.id, ...(t.id === community ? { selected: '' } : {}) }, [t.label ?? t.id])),
  ])
  return el('section', { class: 'zone-filter', 'data-zone-filter-section': '' }, [
    el('div', { class: 'zone-head' }, [outlinerToggle(open, S.zoneFilterTitle, () => { setUi(d.s, 'filterOpen', !open); d.onChange() }, { 'data-zone-filter-toggle': '' }), el('b', {}, [S.zoneFilterTitle])]),
    ...(open ? [...FILTER_RINGS.map(check), el('label', { class: 'zone-check' }, [S.zoneCommunity, ' ', pick])] : []),
  ])
}

/** The panel beside (desktop) or above (phone) the rings: Filter (advanced), the pinned people on top, then one folding list per zone. */
export function zonePanel(d: ZonePanelDeps): HTMLElement {
  const community = communityOf(d.s)
  const pinned = pinnedOrder(d.people.filter((p) => p.pinned === true), pinnedModeOf(d.s), () => 0)
  const opened = openRings(d.s)
  const zones = TONE_ORDER.flatMap((ring) => {
    const here = d.people.filter((p) => zoneFor(p, community) === ring)
    if (!here.length) return []
    const open = opened.includes(ring)
    return [el('section', { class: 'zone-list', 'data-zone-list': ring, style: `--tone:${toneVar(ring)}` }, [
      el('div', { class: 'zone-head' }, [
        outlinerToggle(open, open ? S.zoneFold : S.zoneUnfold, () => { toggleRing(d.s, 'open', ring); d.onChange() }, { 'data-zone-toggle': ring }),
        el('b', {}, [S.ringLabel[ring]]), ' ', el('span', { class: 'meta' }, [`(${here.length})`]),
      ]),
      ...(open ? [el('p', { class: 'meta' }, [S.ringHint[ring]]), ...pinnedOrder(here, pinnedModeOf(d.s), () => 0).map((p) => row(d, p, p.pinned === true))] : []),
    ])]
  })
  return el('aside', { class: 'zone-panel', 'data-zone-panel': '' }, [
    filterSection(d),
    ...(pinned.length ? [el('section', { class: 'zone-list', 'data-zone-pinned': '' }, [el('div', { class: 'zone-head' }, [el('b', {}, [S.zonePinned]), ' ', el('span', { class: 'meta' }, [`(${pinned.length})`])]), ...pinned.map((p) => row(d, p, true))])] : []),
    ...zones,
  ])
}

/** One line per kind of zzz suggestion with "move all": the second tap of the zzz pair (the first is the marker on the dot). */
export function zzzStrip(kinds: readonly MoveKind[], onAll: (ids: readonly string[]) => void): HTMLElement | null {
  if (!kinds.length) return null
  return el('div', { class: 'zzz-strip', 'data-zzz-strip': '' }, kinds.map((k) => el('button', {
    class: 'btn btn-ghost btn-sm', 'data-zzz-all': `${k.from}>${k.to}`, onclick: () => onAll(k.ids),
  }, [`💤 ${S.zoneZzzAll(k.ids.length, S.ringLabel[k.from], S.ringLabel[k.to])}`])))
}

/** "solid = both know each other, dashed = one-way", folded under an (i). */
export function legendInfo(): HTMLElement {
  const text = el('p', { class: 'meta zone-legend', 'data-zone-legend': '', hidden: '' }, [S.zoneLegend])
  const btn = el('button', { class: 'hint-i', 'data-zone-legend-i': '', 'aria-expanded': 'false', 'aria-label': S.zoneLegendInfo, onclick: () => { text.hidden = !text.hidden; btn.setAttribute('aria-expanded', String(!text.hidden)) } }, ['i'])
  return el('div', { class: 'zone-legend-box' }, [btn, text])
}

/** Wave 28b: the two chip inputs of the sidebar's Filters (advanced), the share page's chips and typeahead (share_page.ts): "show only" keeps matches, "hide" removes them and wins. Both filter the dots on the web. */
function tagFilters(d: Pick<ZonePanelDeps, 's' | 'people' | 'tags' | 'onChange'>): HTMLElement {
  const cands = candidates({ people: d.people, tags: d.tags })
  const label = (id: string): string => (id.startsWith('person:') ? '@' : '#') + (cands.find((c) => c.id === id)?.label ?? id)
  const page = (): ReturnType<typeof initial> => ({ ...initial(), include: d.s.uiRings?.show ?? [], exclude: d.s.uiRings?.hide ?? [] })
  const store = (p: ReturnType<typeof initial>): void => { setUi(d.s, 'show', p.include); setUi(d.s, 'hide', p.exclude); d.onChange() }
  /** Wave 29: the tag the "Add people" row serves, and who it added in this go (undo = ×). */
  const target = (): { id: string; label: string } | undefined => { const t = d.tags.find((x) => x.id === addingTo.tag); return t ? { id: t.id, label: t.label ?? t.id } : undefined }
  const createLabel = (c: CreateRow): string => (c.create === 'person' ? S.filterCreatePerson(c.name) : S.filterCreateTag(c.name))
  /** Creates what the row names; returns the new chip id (person:<id> / tag:<id>). */
  const create = (c: CreateRow): string => {
    if (c.create === 'person') return 'person:' + createPerson(d.s.people, c.name, randomId(8), Date.now()).id
    const t = createTag(d.tags, c.name)
    saveColourTags([...d.tags, t])
    return 'tag:' + t.id
  }
  const choose = (r: ChipRow, id: string): void => {
    if (id.startsWith('tag:')) { addingTo.tag = id.slice(4); addingTo.added = [] }
    store(withChip(page(), r, id))
  }
  const row = (r: ChipRow): HTMLElement => {
    const name = r === 'include' ? S.zoneShowOnly : S.zoneHide
    const hits = el('div', { class: 'share-hits' })
    const input = el('input', { class: 'field', placeholder: S.shareChipPh, 'aria-label': name, autocomplete: 'off', 'data-zone-chip-input': r }) as HTMLInputElement
    const rows = (): ReturnType<typeof suggestOrCreate> => suggestOrCreate(input.value, cands, [...page().include, ...page().exclude])
    const pickRow = (x: ReturnType<typeof suggestOrCreate>[number]): void => choose(r, 'create' in x ? create(x) : x.id)
    input.addEventListener('input', () => hits.replaceChildren(...rows().map((x) => el('button', 'create' in x
      ? { class: 'chip', 'data-zone-chip-create': x.create, onclick: () => pickRow(x) }
      : { class: 'chip', 'data-zone-chip-suggest': x.id, onclick: () => pickRow(x) }, ['create' in x ? createLabel(x) : label(x.id)]))))
    input.addEventListener('keydown', (e) => { const first = rows()[0]; if ((e as KeyboardEvent).key === 'Enter' && first) pickRow(first) })
    return el('div', { class: 'zone-chip-row', 'data-zone-chip-row': r }, [
      el('b', {}, [name]),
      el('div', { class: 'chips' }, page()[r].map((id) => el('button', {
        class: 'chip on', 'data-zone-chip': id, 'aria-label': S.shareChipRemove(label(id)), onclick: () => store(withoutChip(page(), r, id)),
      }, [label(id) + ' ×']))),
      input, hits,
    ])
  }
  /** Wave 29: "Add people to #tag": each Enter tags one person (an existing one, or a new one created on the spot); the chips undo. */
  const addRow = (): HTMLElement | null => {
    const tag = target()
    if (!tag) return null
    const hits = el('div', { class: 'share-hits' })
    const input = el('input', { class: 'field', placeholder: S.filterAddPh, 'aria-label': S.filterAddPeople(tag.label), autocomplete: 'off', 'data-zone-tag-add-input': tag.id }) as HTMLInputElement
    const rows = (): ReturnType<typeof suggestOrCreate> => suggestOrCreate(input.value.trim().startsWith('@') ? input.value : '@' + input.value, cands, d.people.filter((p) => addingTo.added.includes(p.id)).map((p) => 'person:' + p.id))
    const add = (x: ReturnType<typeof suggestOrCreate>[number]): void => {
      const id = 'create' in x ? create(x).slice(7) : x.id.slice(7)
      const who = d.s.people.find((p) => p.id === id)
      if (!who) return
      tagPerson(who, tag.id)
      addingTo.added.push(id)
      d.onChange()
      setTimeout(() => document.querySelector<HTMLInputElement>('[data-zone-tag-add-input]')?.focus(), 0)
    }
    input.addEventListener('input', () => hits.replaceChildren(...(input.value.trim() ? rows() : []).map((x) => el('button', 'create' in x
      ? { class: 'chip', 'data-zone-tag-add-create': '', onclick: () => add(x) }
      : { class: 'chip', 'data-zone-tag-add-suggest': x.id, onclick: () => add(x) }, ['create' in x ? createLabel(x) : label(x.id)]))))
    input.addEventListener('keydown', (e) => { const first = input.value.trim() ? rows()[0] : undefined; if ((e as KeyboardEvent).key === 'Enter' && first) add(first) })
    const added = addingTo.added.flatMap((id) => d.s.people.filter((p) => p.id === id))
    return el('div', { class: 'zone-chip-row', 'data-zone-tag-add': tag.id }, [
      el('b', {}, [S.filterAddPeople(tag.label)]),
      el('div', { class: 'chips' }, added.map((p) => el('button', {
        class: 'chip on', 'data-zone-tag-added': p.id, 'aria-label': S.filterUntag(p.name, tag.label),
        onclick: () => { untagPerson(p, tag.id); addingTo.added = addingTo.added.filter((x) => x !== p.id); d.onChange() },
      }, [p.name + ' ×']))),
      input, hits,
    ])
  }
  const open = d.s.uiRings?.showOpen === true
  return el('section', { class: 'zone-filter', 'data-zone-tag-filters': '' }, [
    el('div', { class: 'zone-head' }, [outlinerToggle(open, S.zoneFilterTitle, () => { setUi(d.s, 'showOpen', !open); d.onChange() }, { 'data-zone-tags-toggle': '' }), el('b', {}, [S.zoneFilterTitle])]),
    ...(open ? [row('include'), row('exclude'), addRow()].filter((x): x is HTMLElement => x !== null) : []),
  ])
}

/** Wave 29: which tag the filter's "Add people" row serves and who it added this go; survives the redraw after each Enter. */
const addingTo: { tag?: string; added: string[] } = { added: [] }

/** Wave 28b: the TrustZones view's only side control (left on desktop, above the rings on the phone, unfolded by default): expand all, add, tag filters. */
export function zoneSidebar(d: Pick<ZonePanelDeps, 's' | 'people' | 'tags' | 'onChange'> & { expand: HTMLElement; add: HTMLElement }): HTMLElement {
  const open = d.s.uiRings?.sidebarOpen !== false
  return el('aside', { class: 'zone-side', 'data-zone-side': '' }, [
    el('div', { class: 'zone-head' }, [outlinerToggle(open, S.zoneSidebarTitle, () => { setUi(d.s, 'sidebarOpen', !open); d.onChange() }, { 'data-zone-side-toggle': '' }), el('b', {}, [S.zoneSidebarTitle])]),
    ...(open ? [el('div', { class: 'zone-tools' }, [d.expand, d.add]), el('label', { class: 'zone-check' }, [
      el('input', { type: 'checkbox', 'data-zone-connections': '', ...(connectionsShown(d.s) ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, 'connections', (e.target as HTMLInputElement).checked); d.onChange() } }),
      ' ', S.zoneConnections,
    ]), tagFilters(d)] : []),
  ])
}
