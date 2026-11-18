// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c answers-44c (A4): Settings > Recently deleted: deleted events, resources, tasks, meetings, invitations (trash.ts) with Restore; people keep their own list on the Web. */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { S } from './strings'
import { recentlyTrashed, restoreTrashed, trashDaysLeft } from './trash'
import type { TrashEntry } from './trash'

/** The name a deleted item is listed under. */
export function trashLabel(t: TrashEntry): string {
  const x = t.item as Record<string, unknown>
  const name = [x.name, x.text, x.title, x.about, x.event, x.place].find((v) => typeof v === 'string' && v.trim())
  return `${S.a44cTrash.kinds[t.kind]}: ${typeof name === 'string' ? name : t.id}`
}

export function trashRows(s: AppState, io: { save(): void; redraw(): void; toast(m: string): void }): Node[] {
  const now = Date.now()
  const list = recentlyTrashed(s, now)
  return [
    el('p', { class: 'meta' }, [S.a44cTrash.hint]),
    ...(list.length ? list.map((t) => el('div', { class: 'trash-row', 'data-trash-row': `${t.kind}:${t.id}` }, [
      el('span', {}, [trashLabel(t)]),
      el('em', { class: 'meta' }, [S.a44cTrash.daysLeft(trashDaysLeft(t, now))]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-trash-restore': `${t.kind}:${t.id}`, onclick: () => { if (restoreTrashed(s, t.kind, t.id)) { io.save(); io.toast(S.a44cTrash.restored(trashLabel(t))); io.redraw() } } }, [S.a44cTrash.restore]),
    ])) : [el('p', { class: 'empty', 'data-trash-empty': '1' }, [S.a44cTrash.empty])]),
  ]
}
