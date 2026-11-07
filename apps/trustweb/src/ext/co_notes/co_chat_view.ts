// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 (co-notes-link): the group chat under a co-note. The members are the note's participants; their chips (in the editor's "With" row) open a 1:1 chat. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { CoCtx } from './co_editor'

const S_ = S.coLink

/** `draft` outlives a redraw of the editor, so a message half typed survives a poll that brought news. */
export function chatPanel(c: CoCtx, id: string, draft: { text: string }): HTMLElement {
  const doc = c.get(id)
  const chat = c.chat
  const others = (doc?.people ?? []).filter((p) => p.did !== c.me().did)
  const input = el('input', {
    class: 'field', placeholder: S_.chatPh, 'aria-label': S_.chatPh, maxlength: '500', autocomplete: 'off', 'data-co-chat-input': '', value: draft.text,
    oninput: () => { draft.text = input.value },
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); send() } },
  }) as HTMLInputElement
  function send(): void {
    const text = input.value.trim()
    if (!text || !chat) return
    draft.text = ''
    input.value = ''
    void chat.say(id, text).then(() => list.replaceChildren(...rows()))
  }
  const rows = (): Node[] => {
    const all = chat?.msgs(id) ?? []
    return all.length
      ? all.map((m) => el('div', { class: 'co-msg' + (m.from.did === c.me().did ? ' mine' : ''), 'data-co-msg': m.id }, [el('b', {}, [m.from.did === c.me().did ? '' : `${m.from.name}: `]), m.text]))
      : [el('p', { class: 'meta' }, [others.length ? S_.chatEmpty : S_.chatAlone])]
  }
  const list = el('div', { class: 'co-msgs', 'data-co-msgs': '', 'aria-live': 'polite' }, rows())
  return el('div', { class: 'co-chat', 'data-co-chat': id }, [
    el('h4', { class: 'eyebrow' }, [S_.chatTitle]),
    list,
    others.length ? el('div', { class: 'co-chat-send' }, [input, el('button', { class: 'btn btn-ghost btn-sm', 'data-co-chat-send': '', onclick: send }, [S_.chatSend])]) : null,
    el('p', { class: 'meta', 'data-co-chat-honest': '' }, [S_.chatHonest]),
  ])
}
