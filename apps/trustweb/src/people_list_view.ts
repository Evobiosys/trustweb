// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The people list page (wave 25): the trust zones (the header's search field filters them) collapsed; rows are drawn only for an opened zone. */
import { el } from '../../demo/src/ui/dom'
import { ringColor } from './model'
import { Ring } from './model'
import type { AppState, Person } from './model'
import { peopleByZone, pinnedPeople, zoneOpen } from './people_list'
import { S } from './strings'
import { personRow } from './people_row_view'
import { archivePerson, restorePerson } from './archived_people'
import { BULK_RINGS, clearSelection, restoreSnapshot, selectGroup, snapshot, toggle } from './multi_select'
import type { Selection } from './multi_select'
import { webSlot } from './rings_layout'

/** What the list needs from main.ts to edit a row: persist, move a person to a ring (the placePerson path), and a toast whose tap undoes. */
export interface RowEdit {
  save(): void
  place(id: string, ring: Ring): void
  toast(msg: string, undo: () => void): void
  /** Gives each zone (ring) the tag of that name; returns the undo. */
  tagZones(rings: readonly Ring[], name: string): () => void
}

let query = ''
let redraw: () => void = () => undefined
const flipped = new Set<Ring>()
// Wave 30 multi-select: the mode and the ticked people; a fresh visit starts without it.
let selecting = false
let selected: Selection = clearSelection()

/** A fresh visit starts with an empty search and the closest few open, the other zones collapsed. */
export function resetPeopleList(startQuery = ''): void {
  query = startQuery
  flipped.clear()
  selecting = false
  selected = clearSelection()
}

/** The header magnifier's field filters the list through these (wave 30). */
export function peopleQuery(): string {
  return query
}
export function setPeopleQuery(q: string): void {
  query = q
  redraw()
}

export function peopleListBody(state: () => AppState, openPerson: (id: string) => void, addTo: (ring: Ring, presetHint?: boolean) => void, rowExtra?: (p: Person) => Node[], edit?: RowEdit): HTMLElement {
  const groups = el('div', { class: 'people-groups' })
  const plain = (p: Person): HTMLElement => el('button', { class: 'zoom-row', 'data-person': p.id, onclick: () => openPerson(p.id) }, [
    el('b', {}, [p.name]), p.context ? el('small', { class: 'meta' }, [p.context]) : null,
  ])
  // Wave 30: with `edit` every row gets the pencil, the archive box and the drag; the Map listens for 'people-changed' to redraw its dots.
  const changed = (): void => { draw(); groups.dispatchEvent(new CustomEvent('people-changed', { bubbles: true })) }
  const open = (p: Person): HTMLElement => !edit ? plain(p) : personRow(p, {
    open: openPerson,
    select: selecting ? { checked: selected.has(p.id), toggle: () => { selected = toggle(selected, p.id); drawBar() } } : undefined,
    // A touch hold can raise the press twice (hold timer and the browser's context menu): ticking is idempotent.
    pick: (q) => { selecting = true; if (!selected.has(q.id)) selected = toggle(selected, q.id); draw(); swallowTouchClick() },
    rename: (q, name) => { q.name = name; edit.save(); changed() },
    archive: (q) => { archivePerson(q); edit.save(); changed(); edit.toast(S.rowArchived(q.name), () => { restorePerson(q); edit.save(); changed() }) },
    move: (q, ring) => {
      const was = q.ring
      const suggested = q.ringSuggested
      edit.place(q.id, ring)
      changed()
      edit.toast(S.rowMoved(q.name, S.peopleZone[ring]), () => { edit.place(q.id, was); if (suggested) { q.ringSuggested = true; edit.save() } changed() })
    },
  })
  // Wave 29: the Map view lists people here too, each with its place box beside the row.
  const row = (p: Person): HTMLElement => (rowExtra ? el('div', { class: 'map-row', 'data-map-row': p.id }, [open(p), ...rowExtra(p)]) : open(p))
  const draw = (): void => { drawGroups(); drawBar() }
  // The finger that held the row lifts over its new checkbox: that click must not untick it.
  const swallowTouchClick = (): void => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    const stop = (e: Event): void => { e.stopPropagation(); e.preventDefault() }
    groups.addEventListener('click', stop, { capture: true, once: true })
    setTimeout(() => groups.removeEventListener('click', stop, true), 1000)
  }
  const drawGroups = (): void => {
    const pinned = pinnedPeople(state(), query)
    groups.replaceChildren(...(pinned.length ? [el('section', { class: 'people-zone people-pinned', 'data-zone': 'pinned' }, [
      el('div', { class: 'people-zone-head' }, [el('b', {}, [S.peoplePinned]), el('small', {}, [String(pinned.length)])]),
      ...pinned.map(row),
    ])] : []), ...peopleByZone(state(), query).map(({ ring, people }) => {
    // A search shows its hits: the zones that have some open by themselves.
    const open = zoneOpen(ring, flipped, query.trim() !== '')
    const label = S.peopleZone[ring]
    return el('section', { class: 'people-zone' + (ring === Ring.Unsorted ? ' people-unsorted' : ''), 'data-zone': ring, style: `--rc:${ringColor({ ring })}` }, [
      el('div', { class: 'people-zone-head' }, [
        el('button', {
          class: 'people-zone-toggle', 'aria-expanded': String(open),
          onclick: () => { if (flipped.has(ring)) flipped.delete(ring); else flipped.add(ring); draw() },
        }, [el('span', { class: 'outliner', 'aria-hidden': 'true' }, [open ? '▾' : '▸']), el('b', {}, [label])]),
        // Unsorted is no ring the add sheet offers; it starts people on the acquaintance ring.
        el('button', { class: 'people-zone-add', 'data-zone-add': ring, 'aria-label': S.peopleZoneAdd(label), onclick: () => (ring === Ring.Unsorted ? addTo(Ring.Acquaintance, true) : addTo(ring)) }, ['⊕']),
        selecting && people.length ? el('button', { class: 'row-tool', 'data-zone-all': ring, onclick: () => { selected = selectGroup(selected, people.map((q) => q.id)); draw() } }, [S.selectAll]) : null,
        el('small', {}, [String(people.length)]),
      ]),
      ...(open ? (people.length ? people.map(row) : [el('p', { class: 'meta', 'data-zone-empty': '' }, [S.peopleZoneEmpty])]) : []),
    ])
  }))
  }
  // The bottom tool bar: "Select" while the mode is off; then Move to ring, Add tag, Archive, Done. It wraps, never scrolls sideways.
  const bar = el('div', { class: 'select-bar', 'data-select-bar': '' })
  const act = (run: (ids: Selection) => void): void => {
    const ids = selected
    if (!ids.size) return
    run(ids)
    selected = clearSelection()
    changed()
  }
  const archiveSelected = (ids: Selection): void => {
    const people = state().people
    const snaps = snapshot(people, ids)
    for (const q of people) if (ids.has(q.id)) archivePerson(q)
    edit?.save()
    edit?.toast(S.selectArchived(ids.size), () => { restoreSnapshot(people, snaps); edit?.save(); changed() })
  }
  const drawBar = (): void => {
    if (!edit) return
    if (!selecting) { bar.replaceChildren(el('button', { class: 'row-tool', 'data-select-start': '', onclick: () => { selecting = true; draw() } }, [S.selectStart])); return }
    const n = selected.size
    const moveTo = el('select', { class: 'field select-move', 'data-select-move': '', 'aria-label': S.selectMove, disabled: n === 0, onchange: (e: Event) => {
      const ring = (e.target as HTMLSelectElement).value as Ring
      if (!ring) return
      act((ids) => {
        const list = state().people.filter((q) => ids.has(q.id))
        const snaps = snapshot(state().people, ids)
        for (const q of list) edit.place(q.id, ring)
        edit.toast(S.selectMoved(list.length, S.peopleZone[ring]), () => { for (const sn of snaps) edit.place(sn.id, sn.ring); restoreSnapshot(state().people, snaps); edit.save(); changed() })
      })
    } }, [el('option', { value: '' }, [S.selectMove]), ...BULK_RINGS.map((r) => el('option', { value: r }, [S.peopleZone[r]]))])
    const tag = el('input', { class: 'field select-tag', 'data-select-tag': '', placeholder: S.selectTagPh, 'aria-label': S.selectTagPh, maxlength: '40' }) as HTMLInputElement
    const addTag = (): void => {
      const name = tag.value.trim()
      if (!name || !selected.size) return
      act((ids) => {
        const rings = [...new Set(state().people.filter((q) => ids.has(q.id)).map(webSlot))]
        const undo = edit.tagZones(rings, name)
        edit.toast(S.selectTagged(ids.size, name), () => { undo(); changed() })
      })
    }
    tag.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } })
    bar.replaceChildren(
      el('span', { class: 'select-count', 'data-select-count': '' }, [S.selectCount(n)]),
      moveTo,
      el('span', { class: 'select-tagrow' }, [tag, el('button', { class: 'row-tool', 'data-select-tag-add': '', disabled: n === 0, onclick: addTag }, [S.selectTag])]),
      el('button', { class: 'row-tool', 'data-select-archive': '', disabled: n === 0, onclick: () => act(archiveSelected) }, [S.selectArchive]),
      el('button', { class: 'row-tool', 'data-select-done': '', onclick: () => { selecting = false; selected = clearSelection(); draw() } }, [S.selectDone]),
    )
  }
  redraw = draw
  draw()
  return el('div', { class: 'people-list' }, [groups, bar])
}
