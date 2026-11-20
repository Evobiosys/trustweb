// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 offline-outbox: Settings > Pending. One row per queued send with its status line ("Sent when you are online", then "Sent"). */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { shownItems } from './outbox'
import type { OutboxItem } from './outbox'
import { S } from './strings'

/** The status line of one item. */
export const outboxStatus = (i: OutboxItem): string => (i.state === 'sent' ? S.outbox.sent : i.state === 'failed' ? S.outbox.failed : S.outbox.waiting)

export function outboxRows(s: AppState): Node[] {
  const list = shownItems(s, Date.now())
  return [
    el('p', { class: 'meta' }, [S.outbox.hint]),
    ...(list.length ? list.map((i) => el('div', { class: 'outbox-row', 'data-outbox-row': i.id, 'data-outbox-state': i.state }, [
      el('span', {}, [S.outbox.to(S.outbox.kinds[i.kind] ?? i.kind, s.peers.find((p) => p.id === i.peerId)?.displayName ?? '?')]),
      el('em', {}, [outboxStatus(i)]),
      ...(i.state === 'waiting' && i.tries ? [el('small', { class: 'meta' }, [S.outbox.tries(i.tries)])] : []),
    ])) : [el('p', { class: 'empty', 'data-outbox-empty': '1' }, [S.outbox.empty])]),
  ]
}
