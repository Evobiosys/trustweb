// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c home-default: the Existing requests list (Home tile "See all"): every open request, mine and others', grouped. Text only, never who answered (I2). */
import { el } from '../../demo/src/ui/dom'
import { requestGroups, type RequestRow } from './home_data'
import type { AppState } from './model'
import { S } from './strings'

export function requestsListView(s: AppState, open: (id: string) => void): HTMLElement {
  const g = requestGroups(s)
  const group = (title: string, rows: RequestRow[]): Node | null => rows.length
    ? el('section', { class: 'req-group' }, [el('h3', {}, [title]), el('ul', { class: 'home-rows' }, rows.map((r) => el('li', {}, [el('button', { class: 'lnk home-req', type: 'button', 'data-request': r.id, onclick: () => open(r.id) }, [r.text])])))])
    : null
  const parts = [group(S.homeDefault.toMe, g.toMe), group(S.homeDefault.connects, g.connects), group(S.homeDefault.sent, g.sent),
    g.invites ? el('section', { class: 'req-group' }, [el('h3', {}, [S.homeDefault.invites]), el('p', { class: 'meta' }, [S.home.invitesCount(g.invites)])]) : null]
  return el('div', { class: 'requests-list', 'data-requests-list': '' }, [el('h2', {}, [S.homeDefault.requests]), ...(parts.some(Boolean) ? parts : [el('p', { class: 'meta' }, [S.homeDefault.none])])])
}
