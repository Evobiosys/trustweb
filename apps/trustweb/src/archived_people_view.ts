// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { archivedPeople, restorePerson } from './archived_people'
import { S } from './strings'

/** Wave 30: Settings > Archived people: each archived person with an underlined Restore that puts them back on the ring they had. */
export function archivedPeopleView(people: readonly Person[], restored: () => void): HTMLElement {
  const gone = archivedPeople(people)
  return el('div', { 'data-archived-list': '' }, [
    el('b', {}, [S.archivedTitle]),
    el('p', { class: 'meta' }, [S.archivedHint]),
    ...(gone.length
      ? gone.map((p) => el('div', { class: 'conn-row', 'data-archived-row': p.id }, [
        el('span', {}, [p.name]),
        el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'data-archived-restore': p.id, 'aria-label': S.archivedRestoreAria(p.name), onclick: () => { restorePerson(p); restored() } }, [S.archivedRestore]),
      ]))
      : [el('p', { class: 'meta' }, [S.archivedNone])]),
  ])
}
