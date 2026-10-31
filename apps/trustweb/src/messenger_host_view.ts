// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-host): the Chat screen's extended part, in place under the header: the chosen messenger, or one setup row. DOM only. */
import { el } from '../../demo/src/ui/dom'
import type { MessengerSource, ThreadSummary } from './ext/registry'
import { ageLabel } from './model'
import { pickExtended } from './messenger_host'
import { S } from './strings'

export function threadRows(src: MessengerSource, list: ThreadSummary[], now: number): Node[] {
  if (!list.length) return [el('p', { class: 'empty' }, [S.msgNoThreads])]
  return list.map((t) => el('div', { class: 'prow chat-row', role: 'button', tabindex: '0', 'data-msg-thread': t.id, onclick: () => src.open(t.id) }, [
    el('div', { class: 'who' }, [el('b', {}, [t.title])]),
    t.lastAt ? el('span', { class: 'when' }, [ageLabel(t.lastAt, now)]) : null,
    t.unread > 0 ? el('span', { class: 'dot', role: 'img', 'aria-label': S.chatTabUnread(t.unread) }) : null,
  ]))
}

export function extendedChat(sources: readonly MessengerSource[], chosenId?: string): HTMLElement {
  const box = el('div', { class: 'msg-ext', 'data-msg-ext': '' })
  const pick = pickExtended(sources, chosenId)
  if (pick.kind === 'setup') {
    box.append(el('div', { class: 'msg-setup', 'data-msg-setup': '' }, [
      el('span', {}, [S.msgExtendWith]),
      ...pick.sources.map((s) => el('button', { class: 'btn btn-ghost btn-sm', 'data-msg-setup-src': s.id, onclick: () => s.setup?.() }, [s.label])),
      pick.sources.length ? null : el('i', { class: 'meta' }, [S.msgNoneInstalled]),
    ]))
    return box
  }
  const src = pick.source
  box.dataset.msgSource = src.id
  if (src.status() === 'archive') box.append(el('p', { class: 'meta', 'data-msg-archive': '' }, [S.msgArchive(src.label)]))
  if (src.view) { box.append(...src.view()); return box }
  const list = el('div', { class: 'ppl' }, [el('p', { class: 'meta' }, [S.msgLoading])])
  box.append(list)
  void Promise.resolve(src.threads()).then(
    (ts) => list.replaceChildren(...threadRows(src, ts, Date.now())),
    () => list.replaceChildren(el('p', { class: 'empty' }, [S.msgUnreachable(src.label)])),
  )
  return box
}
