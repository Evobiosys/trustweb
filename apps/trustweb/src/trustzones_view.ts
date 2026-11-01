// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (trustzones.ts): the pieces the TrustZones screen draws besides the rings: the outliner triangle, the zone panel (filter, pinned, one folding list per zone), the zzz strip, the legend. */
import { el } from '../../demo/src/ui/dom'
import { type ColourTag } from './colour_tags'
import { renamedTo } from './card_name'
import { HELLO_NAME_MAX } from './hello'
import { pinnedModeOf, pinnedOrder } from './membranes_five'
import type { AppState, Person } from './model'
import { S } from './strings'
import { tapEdit } from './tap_edit'
import { TONE_ORDER, communityOf, communityTags, filterOpen, openRings, setUi, toggleRing, toneVar, unsortedShown, acquaintancesShown, zoneFor } from './trustzones'
import type { MoveKind } from './trustzones'

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

function filterSection(d: ZonePanelDeps): HTMLElement {
  const open = filterOpen(d.s)
  const check = (key: 'acquaintances' | 'unsorted', label: string, on: boolean): HTMLElement => el('label', { class: 'zone-check' }, [
    el('input', { type: 'checkbox', 'data-zone-filter': key, ...(on ? { checked: '' } : {}), onchange: (e: Event) => { setUi(d.s, key, (e.target as HTMLInputElement).checked); d.onChange() } }),
    ' ', label,
  ])
  const community = communityOf(d.s)
  const pick = el('select', { class: 'field', 'data-zone-community': '', 'aria-label': S.zoneCommunity, onchange: (e: Event) => { setUi(d.s, 'community', (e.target as HTMLSelectElement).value || undefined); d.onChange() } }, [
    el('option', { value: '' }, [S.zoneCommunityNone]),
    ...communityTags(d.tags).map((t) => el('option', { value: t.id, ...(t.id === community ? { selected: '' } : {}) }, [t.label ?? t.id])),
  ])
  return el('section', { class: 'zone-filter', 'data-zone-filter-section': '' }, [
    el('div', { class: 'zone-head' }, [outlinerToggle(open, S.zoneFilterTitle, () => { setUi(d.s, 'filterOpen', !open); d.onChange() }, { 'data-zone-filter-toggle': '' }), el('b', {}, [S.zoneFilterTitle])]),
    ...(open ? [check('acquaintances', S.zoneFilterAcq, acquaintancesShown(d.s)), check('unsorted', S.zoneFilterUnsorted, unsortedShown(d.s)), el('label', { class: 'zone-check' }, [S.zoneCommunity, ' ', pick])] : []),
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
