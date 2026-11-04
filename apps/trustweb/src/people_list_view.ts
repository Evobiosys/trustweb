// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The people list page (wave 25): the trust zones (the header's search field filters them) collapsed; rows are drawn only for an opened zone. */
import { el } from '../../demo/src/ui/dom'
import { ringColor } from './model'
import { Ring } from './model'
import type { AppState, Person } from './model'
import { peopleByZone, pinnedPeople, zoneOpen } from './people_list'
import { S } from './strings'

let query = ''
let redraw: () => void = () => undefined
const flipped = new Set<Ring>()

/** A fresh visit starts with an empty search and the closest few open, the other zones collapsed. */
export function resetPeopleList(startQuery = ''): void {
  query = startQuery
  flipped.clear()
}

/** The header magnifier's field filters the list through these (wave 30). */
export function peopleQuery(): string {
  return query
}
export function setPeopleQuery(q: string): void {
  query = q
  redraw()
}

export function peopleListBody(state: () => AppState, openPerson: (id: string) => void, addTo: (ring: Ring, presetHint?: boolean) => void, rowExtra?: (p: Person) => Node[]): HTMLElement {
  const groups = el('div', { class: 'people-groups' })
  const open = (p: Person): HTMLElement => el('button', { class: 'zoom-row', 'data-person': p.id, onclick: () => openPerson(p.id) }, [
    el('b', {}, [p.name]), p.context ? el('small', { class: 'meta' }, [p.context]) : null,
  ])
  // Wave 29: the Map view lists people here too, each with its place box beside the row.
  const row = (p: Person): HTMLElement => (rowExtra ? el('div', { class: 'map-row', 'data-map-row': p.id }, [open(p), ...rowExtra(p)]) : open(p))
  const draw = (): void => {
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
        el('small', {}, [String(people.length)]),
      ]),
      ...(open ? (people.length ? people.map(row) : [el('p', { class: 'meta', 'data-zone-empty': '' }, [S.peopleZoneEmpty])]) : []),
    ])
  }))
  }
  redraw = draw
  draw()
  return el('div', { class: 'people-list' }, [groups])
}
