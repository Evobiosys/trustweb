// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 card-inventory: the ONE resource list. `whose` picks mine (My Resources) or theirs (a person's card); the rows look and change alike. */
import { el } from '../../demo/src/ui/dom'
import { recentMark } from './peer_items'
import { S } from './strings'
import { emojiTitle } from './title_emoji'

export interface ResourceRow { id: string; title: string; chips: readonly (string | null | undefined)[]; at?: number; onOpen?: () => void; /** answers-44d: the algorithmic emoji before the title (Settings > Appearance). */ emoji?: boolean; /** answers-44d: "shared by <name> · <age>" (name null = me), the absolute time in the tooltip. */ by?: { name: string | null; age: string; at: number } }

const chip = (t: string, recent = false): HTMLElement => el('span', { class: 'cal-chip' + (recent ? ' recent-chip' : ''), ...(recent ? { 'data-recent': '' } : {}) }, [t])

/** The "recent" chip of an item younger than 30 days, in my list and in theirs alike; null otherwise. */
export const recentChip = (at: number | undefined, now: number): HTMLElement | null => (recentMark(at, now) ? chip(S.resRecent, true) : null)

export function resourceList(whose: 'mine' | 'theirs', rows: readonly ResourceRow[], now: number): HTMLElement {
  return el('div', { class: 'zoom-rows', 'data-resource-list': whose }, rows.map((r) => el(r.onOpen ? 'button' : 'div', { class: 'prow zoom-row', 'data-item': r.id, ...(r.onOpen ? { onclick: r.onOpen } : {}) }, [
    el('b', {}, [emojiTitle(r.title, r.emoji === true)]),
    r.by ? el('small', { class: 'meta rs-by', 'data-shared-by': r.by.name ?? 'me', title: new Date(r.by.at).toLocaleString() }, [S.a44d.sharedBy(r.by.name ?? S.a44d.me, r.by.age)]) : null,
    el('div', { class: 'cal-chips' }, [...r.chips.map((c) => (c ? chip(c) : null)), recentChip(r.at, now)]),
  ])))
}
