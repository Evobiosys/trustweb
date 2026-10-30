// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The people list page (wave 25): a search field, then the trust zones collapsed; rows are drawn only for an opened zone. */
import { el } from '../../demo/src/ui/dom'
import { ringColor } from './model'
import type { AppState, Ring } from './model'
import { peopleByZone } from './people_list'
import { S } from './strings'

let query = ''
const opened = new Set<Ring>()

/** A fresh visit starts with an empty search and every zone collapsed. */
export function resetPeopleList(): void {
  query = ''
  opened.clear()
}

export function peopleListBody(state: () => AppState, openPerson: (id: string) => void, autofocus: boolean): HTMLElement {
  const groups = el('div', { class: 'people-groups' })
  const draw = (): void => groups.replaceChildren(...peopleByZone(state(), query).map(({ ring, people }) => {
    // A search shows its hits: the zones that have some open by themselves.
    const open = opened.has(ring) || query.trim() !== ''
    return el('section', { class: 'people-zone', 'data-zone': ring }, [
      el('button', {
        class: 'people-zone-head', style: `--rc:${ringColor({ ring })}`, 'aria-expanded': String(open),
        onclick: () => { if (opened.has(ring)) opened.delete(ring); else opened.add(ring); draw() },
      }, [el('b', {}, [S.ringLabel[ring]]), el('small', {}, [String(people.length)])]),
      ...(open ? people.map((p) => el('button', { class: 'zoom-row', 'data-person': p.id, onclick: () => openPerson(p.id) }, [
        el('b', {}, [p.name]), p.context ? el('small', { class: 'meta' }, [p.context]) : null,
      ])) : []),
    ])
  }))
  const input = el('input', {
    class: 'field', type: 'search', placeholder: S.peopleSearchPh, 'aria-label': S.peopleSearchPh, 'data-people-search': '', value: query,
    oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; draw() },
  })
  draw()
  if (autofocus) setTimeout(() => input.focus(), 0)
  return el('div', { class: 'people-list' }, [input, groups])
}
