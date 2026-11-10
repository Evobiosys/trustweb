// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (trustzones.ts): the pieces the TrustZones screen draws besides the rings: the outliner triangle, the zone panel (filter, pinned, one folding list per zone), the zzz strip, the legend. */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { type ColourTag, saveColourTags, setShowSystemTags, showSystemTags } from './colour_tags'
import { IMAGE_MODES, imageMode, setImageMode } from './image_mode'
import { chipInput } from './chip_input'
import { tagPill } from './components/tag_pill'
import { candidates, initial, withChip, withoutChip } from './share_page'
import { createPerson, createTag, suggestOrCreate, tagPerson, untagPerson } from './tag_create'
import type { CreateRow } from './tag_create'
import type { ChipRow } from './share_page'
import type { AppState, Person, Ring } from './model'
import { S } from './strings'
import { FILTER_RINGS, ringShown, setRingShown } from './rings_filter'
import { communityOf, communityTags, filterOpen, setUi } from './trustzones'
import { connectionsShown } from './zone_connections'
import { activeCountLabel, activeFilters } from './filter_active'
import { closestLimit, closestMoot, limitOf, parseLimit, setPerRingLimit } from './membranes_five'
import { webSlot } from './rings_layout'
import { panelMode } from './filter_panel'

/** The one outliner glyph (G2): a triangle pointing right while folded, down while unfolded. */
export const triangle = (open: boolean): string => (open ? '▾' : '▸')

/** A fold control: the triangle, `label` for screen readers. Extra attributes (data-*, class) ride along. */
export function outlinerToggle(open: boolean, label: string, onToggle: (btn: HTMLElement) => void, attrs: Record<string, string> = {}): HTMLElement {
  const b = el('button', { type: 'button', 'aria-expanded': String(open), 'aria-label': label, title: label, ...attrs, class: 'outliner-toggle ' + (attrs.class ?? ''), onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); onToggle(b) } }, [triangle(open)])
  return b
}

/** Wave 34: a number shown as an underlined dashed button; a tap turns it into a number field, Enter or leaving it saves (Esc keeps the old number). */
function numEdit(value: number, attr: string, onSave: (raw: string) => void): HTMLElement {
  const btn = el('button', { type: 'button', class: 'num-edit', [attr]: '', 'aria-label': S.numEditAria, onclick: (e: Event) => {
    e.preventDefault()
    const input = el('input', { type: 'number', class: 'field num-edit-input', min: '1', value: String(value), 'aria-label': S.numEditAria, [attr + '-input']: '' }) as HTMLInputElement
    let done = false
    const finish = (save: boolean): void => { if (done) return; done = true; if (save) onSave(input.value); else input.replaceWith(btn) }
    input.addEventListener('keydown', (k) => { if (k.key === 'Enter') { k.preventDefault(); finish(true) } else if (k.key === 'Escape') finish(false) })
    input.addEventListener('blur', () => finish(true))
    btn.replaceWith(input); input.focus(); input.select()
  } }, [String(value)])
  return btn
}

/** Wave 30 (U9): one row per active chip ("Only #family ✕") plus "Show everyone"; empty when no filter is on. */
function activeRows(d: Pick<ZonePanelDeps, 's' | 'tags' | 'onChange'>): HTMLElement[] {
  const active = activeFilters(d.s.uiRings, d.tags, d.s.people, limitOf(d.s))
  const off = (keep: (chip: string) => boolean): void => { setUi(d.s, 'show', (d.s.uiRings?.show ?? []).filter(keep)); setUi(d.s, 'hide', (d.s.uiRings?.hide ?? []).filter(keep)); if (!keep('closest150')) setUi(d.s, 'closest150', false); if (!keep('perRing')) { delete d.s.membraneLimit; setUi(d.s, 'rankBy', undefined) }; d.onChange() }
  const link = (attrs: Record<string, string>, label: string, onclick: () => void): HTMLElement => el('button', { type: 'button', class: 'btn btn-ghost btn-sm filter-off', ...attrs, onclick }, [label])
  return active.length ? [
    ...active.map((a) => el('div', { class: 'filter-active', 'data-filter-active': a.chip }, [el('span', {}, [a.label]), link({ 'data-filter-off': a.chip, 'aria-label': S.filterOff(a.label) }, '✕', () => off((c) => c !== a.chip))])),
    el('div', { class: 'filter-active' }, [link({ 'data-filter-off-all': '' }, S.tagFilterClear, () => off(() => false))]),
  ] : []
}

export interface ZonePanelDeps {
  s: AppState
  /** Everyone the zones show (trustzones.ts inZones). */
  people: readonly Person[]
  tags: readonly ColourTag[]
  /** A view setting changed (already written to s.uiRings): save and redraw. */
  onChange: () => void
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
    el('div', { class: 'zone-head' }, [outlinerToggle(open, S.zoneFilterTitle, () => { setUi(d.s, 'filterOpen', !open); d.onChange() }, { 'data-zone-filter-toggle': '' }), el('b', {}, [S.zoneFilterTitle + (open ? '' : activeCountLabel(activeFilters(d.s.uiRings, d.tags, d.s.people, limitOf(d.s)).length))])]),
    ...(open ? [...activeRows(d), ...FILTER_RINGS.map(check), el('label', { class: 'zone-check' }, [S.zoneCommunity, ' ', pick])] : []),
  ])
}

/** Wave 36b: the trust-zone (ring) filter, collapsed under "Trust zones ▸"; main.ts mounts it on the Network and Map views only (select_tool.ts ringFilterShown). */
let ringFilterOpen = false
export function trustZonesGroup(d: Pick<ZonePanelDeps, 's' | 'onChange'>): HTMLElement {
  const check = (ring: Ring): HTMLElement => el('label', { class: 'zone-check' }, [
    el('input', { type: 'checkbox', 'data-zone-filter': ring, ...(ringShown(d.s, ring) ? { checked: '' } : {}), onchange: (e: Event) => { setRingShown(d.s, ring, (e.target as HTMLInputElement).checked); d.onChange() } }),
    ' ', S.ringLabel[ring],
  ])
  const box = el('details', { class: 'filter-group ring-filter', 'data-filter-group': 'trustzones', ...(ringFilterOpen ? { open: '' } : {}) }, [
    el('summary', {}, [S.ringFilterTitle]),
    ...FILTER_RINGS.map(check),
  ])
  box.addEventListener('toggle', () => { ringFilterOpen = (box as HTMLDetailsElement).open })
  return box
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
    const { input, hits } = chipInput({
      placeholder: S.shareChipPh, aria: name, attrs: { 'data-zone-chip-input': r },
      hits: (text) => suggestOrCreate(text, cands, [...page().include, ...page().exclude]).map((x) => ({
        label: 'create' in x ? createLabel(x) : label(x.id),
        attrs: { [('create' in x ? 'data-zone-chip-create' : 'data-zone-chip-suggest')]: 'create' in x ? x.create : x.id },
        pick: () => choose(r, 'create' in x ? create(x) : x.id),
      })),
    })
    return el('div', { class: 'zone-chip-row', 'data-zone-chip-row': r }, [
      el('b', {}, [name]),
      el('div', { class: 'chips' }, page()[r].map((id) => {
        const tag = id.startsWith('tag:') ? d.tags.find((x) => x.id === id.slice(4)) : undefined
        const attrs = { 'data-zone-chip': id, 'aria-label': S.shareChipRemove(label(id)) }
        const remove = (): void => store(withoutChip(page(), r, id))
        // Wave 40: a tag chip is the tag pill (group tags with their ring).
        return tag ? tagPill(tag, { class: 'chip on', attrs, text: (tag.label ?? tag.id) + ' ×', onclick: remove }) : el('button', { class: 'chip on', ...attrs, onclick: remove }, [label(id) + ' ×'])
      })),
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
    return el('div', { class: 'zone-chip-row zone-add-box', 'data-zone-add-people': '', 'data-zone-tag-add': tag.id }, [
      el('b', {}, [S.filterAddPeople(tag.label)]),
      el('div', { class: 'chips' }, added.map((p) => el('button', {
        class: 'chip on', 'data-zone-tag-added': p.id, 'aria-label': S.filterUntag(p.name, tag.label),
        onclick: () => { untagPerson(p, tag.id); addingTo.added = addingTo.added.filter((x) => x !== p.id); d.onChange() },
      }, [p.name + ' ×']))),
      input, hits,
    ])
  }
  // Wave 39: the Filters button (zoneSidebar) owns the head and the folding; this is only the body.
  return el('section', { class: 'zone-filter', 'data-zone-tag-filters': '' }, [...activeRows(d), el('b', { class: 'filter-group-title', 'data-filter-group-title': 'tags' }, [S.filterTagsTitle]), row('include'), row('exclude'), addRow()].filter((x): x is HTMLElement => x !== null))
}

/** Wave 29: which tag the filter's "Add people" row serves and who it added this go; survives the redraw after each Enter. */
const addingTo: { tag?: string; added: string[] } = { added: [] }

/** Wave 28b: the TrustZones view's only side control (left on desktop, above the rings on the phone, unfolded by default): expand all, add, tag filters. */
export function zoneSidebar(din: Pick<ZonePanelDeps, 's' | 'people' | 'tags' | 'onChange'> & { expand: HTMLElement; add: HTMLElement; select: HTMLElement; hiddenCount: number; openHidden: () => void; spaceOut: () => void; deletedCount: number; openDeleted: () => void; /** Phone: the overlay sheet (main.ts openSheet). */ openPanel: (children: (Node | null)[]) => void }): HTMLElement {
  // Wave 39: on a phone Tools and Filters open as an overlay sheet that redraws after each change; wider, they fold open inline.
  const sheet = panelMode(window.innerWidth) === 'sheet'
  let showing: 'tools' | 'filters' | null = null
  const d = { ...din, onChange: (): void => { din.onChange(); if (showing) present(showing) } }
  const toolsOpen = d.s.uiRings?.sidebarOpen !== false
  const filtersOpen = d.s.uiRings?.showOpen === true
  /** The Tools rows, built fresh (the sheet redraws them after each change). */
  const toolsRows = (): Node[] => {
    const m = limitOf(d.s)
    const rings = new Set(d.people.map((p) => webSlot(p))).size
    // Wave 36b: "closest n" adds nothing while the per-ring cut already stays within n (and the cut is on).
    const moot = !d.s.uiRings?.perRingLimitOff && closestMoot(m, rings, closestLimit(d.s.uiRings))
    /** Every Tools row is one line: a leading control, then its label. */
    const action = (attr: string, glyph: string, label: string, enabled: boolean, onclick: () => void): HTMLElement =>
      el('div', { class: 'zone-check zone-row' }, [el('button', { type: 'button', class: 'row-action', [attr]: '', ...(enabled ? {} : { disabled: '' }), onclick }, [el('span', { 'aria-hidden': 'true', class: 'row-glyph' }, [glyph]), el('u', {}, [label])])])
    const connections = el('label', { class: 'zone-check zone-row' }, [
      el('input', { type: 'checkbox', 'data-zone-connections': '', ...(connectionsShown(d.s) ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, 'connections', (e.target as HTMLInputElement).checked); d.onChange() } }),
      ' ', S.zoneConnections,
    ])
    const perRing = el('label', { class: 'zone-check zone-row' }, [
      el('input', { type: 'checkbox', 'data-per-ring': '', ...(d.s.uiRings?.perRingLimitOff ? {} : { checked: '' }), onchange: (e: Event) => { setUi(d.s, 'perRingLimitOff', (e.target as HTMLInputElement).checked ? undefined : true); if ((e.target as HTMLInputElement).checked) setUi(d.s, 'filled', undefined); d.onChange() } }),
      ' ', S.perRingBefore, numEdit(m, 'data-per-ring-m', (raw) => { const n = parseLimit(raw); if (n !== null) setPerRingLimit(d.s, n); d.onChange() }), ' ',
      el('button', { type: 'button', class: 'num-edit', 'data-recent-mode': '', onclick: (e: Event) => { e.preventDefault(); setUi(d.s, 'rankBy', d.s.uiRings?.rankBy === 'frequent' ? undefined : 'frequent'); d.onChange() } }, [d.s.uiRings?.rankBy === 'frequent' ? S.perRingFrequent : S.perRingRecent]), S.perRingAfter,
    ])
    const autoAdjust = el('label', { class: 'zone-check zone-row', title: S.ringsAutoAdjustHint }, [
      el('input', { type: 'checkbox', 'data-rings-auto-adjust': '', ...(d.s.uiRings?.autoAdjust ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, 'autoAdjust', (e.target as HTMLInputElement).checked ? true : undefined); d.onChange() } }),
      ' ', S.ringsAutoAdjust,
    ])
    const closest = el(moot ? 'div' : 'label', { class: 'zone-check zone-row' + (moot ? ' moot' : ''), ...(moot ? { 'aria-disabled': 'true', 'data-closest-moot': '1', title: S.closestMootHint(m * rings) } : {}) }, [
      el('input', { type: 'checkbox', 'data-closest150': '', ...(moot ? { disabled: '' } : {}), ...(d.s.uiRings?.closest150 ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, 'closest150', (e.target as HTMLInputElement).checked); d.onChange() } }),
      ' ', S.closestBefore, numEdit(closestLimit(d.s.uiRings), 'data-closest-n', (raw) => { const n = Number.parseFloat(raw); if (Number.isFinite(n)) setUi(d.s, 'closestN', closestLimit({ closestN: n })); d.onChange() }), S.closestAfter,
      ...(moot ? [el('small', { class: 'moot-hint' }, [S.closestMootHint(m * rings)])] : []),
    ])
    /** Wave 39: the import tags (#import:<date>-<source>) stay hidden unless this is on. */
    const systemTags = el('label', { class: 'zone-check zone-row', title: S.imp39.systemTagsHint }, [
      el('input', { type: 'checkbox', 'data-show-system-tags': '', ...(showSystemTags() ? { checked: '' } : {}), onchange: (e: Event) => { setShowSystemTags((e.target as HTMLInputElement).checked); d.onChange() } }),
      ' ', S.imp39.systemTags,
    ])
    /** Wave 40: Images: show / grey out / hide, for every picture the app draws (image_mode.ts); a device setting like the system-tags switch. */
    const images = el('div', { class: 'zone-check zone-row', 'data-images-row': '', role: 'group', 'aria-label': S.imagesRow.aria }, [
      S.imagesRow.label + ': ',
      ...IMAGE_MODES.flatMap((m) => [el('button', { type: 'button', class: 'num-edit' + (imageMode() === m ? ' on' : ''), 'data-images-mode': m, 'aria-pressed': String(imageMode() === m), onclick: () => { setImageMode(m); d.onChange() } }, [S.imagesRow.modes[m]]), ' ']),
    ])
    return [el('div', { class: 'zone-tools' }, [d.expand, d.add, d.select]), connections, perRing, autoAdjust, closest, systemTags, images, action('data-space-out-tools', '⤧', S.spaceOutEvenly, true, d.spaceOut), el('label', { class: 'zone-check zone-row' }, [
      el('input', { type: 'checkbox', 'data-expand-buttons': '', ...(d.s.uiRings?.expandButtons ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, 'expandButtons', (e.target as HTMLInputElement).checked ? true : undefined); d.onChange() } }),
      ' ', S.expandButtonsLabel,
    ]), action('data-hidden-people', '◌', S.hiddenPeopleBtn(d.hiddenCount), d.hiddenCount > 0, d.openHidden), action('data-recently-deleted', '↺', S.recentlyDeleted(d.deletedCount), d.deletedCount > 0, d.openDeleted)]
  }
  const filterCount = activeCountLabel(activeFilters(d.s.uiRings, d.tags, d.s.people).length)
  /** The two buttons: inline they fold their section open; on a phone they open the overlay sheet. */
  const present = (kind: 'tools' | 'filters'): void => {
    showing = kind
    d.openPanel([el('h3', {}, [kind === 'tools' ? S.zoneSidebarTitle : S.filtersButton]), ...(kind === 'tools' ? toolsRows() : [tagFilters(d)])])
  }
  const button = (kind: 'tools' | 'filters', open: boolean, label: string, attr: string, fold: () => void): HTMLElement =>
    el('button', { type: 'button', class: 'zone-switch-btn', 'aria-expanded': String(!sheet && open), 'aria-haspopup': sheet ? 'dialog' : false, [attr]: '', onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); if (sheet) present(kind); else fold() } },
      [sheet ? '' : triangle(open) + ' ', el('u', {}, [label])])
  return el('aside', { class: 'zone-side', 'data-zone-side': '' }, [
    el('div', { class: 'zone-switch' }, [
      button('tools', toolsOpen, S.zoneSidebarTitle, 'data-zone-side-toggle', () => { setUi(d.s, 'sidebarOpen', !toolsOpen); d.onChange() }),
      button('filters', filtersOpen, S.filtersButton + filterCount, 'data-zone-tags-toggle', () => { setUi(d.s, 'showOpen', !filtersOpen); d.onChange() }),
    ]),
    ...(!sheet && toolsOpen ? toolsRows() : []),
    ...(!sheet && filtersOpen ? [tagFilters(d)] : []),
  ])
}
