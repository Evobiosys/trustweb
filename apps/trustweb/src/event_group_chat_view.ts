// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat: the sheet of an event's ONE shared thread (event_group_chat.ts). Members line, the thread (chat_view.ts bubbles:
 * mine right, theirs left with the author's name; joins and leaves as a centred note), a composer, and Leave / Join again for a guest.
 * Text goes in as text nodes only. The open sheet redraws when its thread changes (refresh), the draft in the composer stays.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { eventTagLabel } from './event_tag'
import { tagLabel } from './events'
import { injectChatStyles } from './chat_view'
import type { EventEnvelope } from '../../demo/src/types'
import { EVENT_CHAT_TEXT_MAX, createEventGroupChat, memberNames, threadOf, type GcItem } from './event_group_chat'
import { isEventHost } from './event_roles'
import { S } from './strings'

export interface EventChatViewDeps<P extends { id: string }> {
  st: () => AppState
  save: () => void
  openSheet: (body: (Node | null)[]) => void
  newId: () => string
  peers: () => P[]
  /** net.ts sendEvent: sealed with the pair key. */
  send: (peer: P, env: EventEnvelope) => Promise<void>
}

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function itemNode(i: GcItem): HTMLElement {
  if (i.k !== 'msg') return el('p', { class: 'chat-note ec-notice', 'data-event-chat-item': i.k }, [i.k === 'join' ? S.w45gc.joined(i.by) : S.w45gc.left(i.by)])
  return el('div', { class: `chat-msg ${i.mine ? 'chat-out' : 'chat-in'}`, 'data-event-chat-item': 'msg' }, [
    i.mine ? null : el('span', { class: 'chat-by' }, [i.by]),
    el('span', { class: 'chat-text' }, [i.text ?? '']),
    el('span', { class: 'chat-meta' }, [[time(i.ts), i.state === 'pending' ? S.w45gc.waiting : ''].filter(Boolean).join(' · ')]),
  ])
}

/** The engine (event_group_chat.ts) wired to this sheet: what main.ts holds. */
export function createEventChatView<P extends { id: string }>(d: EventChatViewDeps<P>) {
  let shown: { id: string; root: HTMLElement; draw: () => void } | null = null
  const chat = createEventGroupChat<P>({ state: d.st, save: d.save, now: Date.now, newId: d.newId, peers: d.peers, send: d.send, changed: (id) => { if (shown?.id === id && shown.root.isConnected) shown.draw() } })

  function open(id: string): void {
    const ev = d.st().events?.find((e) => e.id === id)
    if (!ev) return
    injectChatStyles(document)
    const members = el('p', { class: 'meta', 'data-event-chat-members': '' })
    const thread = el('div', { class: 'chat-thread', role: 'log', 'data-event-chat-thread': '' })
    const note = el('p', { class: 'chat-note' })
    const area = el('textarea', { class: 'field', rows: '2', maxlength: String(EVENT_CHAT_TEXT_MAX), placeholder: S.w45gc.ph, 'aria-label': S.w45gc.ph, 'data-event-chat-text': '' }) as HTMLTextAreaElement
    const sendBtn = el('button', { class: 'btn btn-electric', type: 'button', 'data-event-chat-send': '', onclick: () => {
      const text = area.value
      void chat.send(id, text).then((item) => { if (item) area.value = '' })
    } }, [S.w45gc.send]) as HTMLButtonElement
    const compose = el('div', { class: 'ec-compose' }, [area, sendBtn])
    const leaveBox = el('div', { class: 'ec-leave' })
    const root = el('div', { class: 'chat event-chat', 'data-event-chat': id }, [
      el('h3', {}, [S.w45gc.title(eventTagLabel(tagLabel(ev)))]), members, el('p', { class: 'chat-note' }, [S.w45gc.hint]), thread, note, compose, leaveBox,
    ])
    const draw = (): void => {
      const s = d.st()
      const e = s.events?.find((x) => x.id === id)
      if (!e) return
      const t = threadOf(s, id)
      const left = t.mem?.me?.on === false
      const host = isEventHost(e, s.me.displayName, s.people)
      const inIt = host || e.attended
      members.textContent = S.w45gc.members(memberNames(s, e).join(', '))
      thread.replaceChildren(...(t.items.length ? t.items.map(itemNode) : [el('p', { class: 'chat-note', 'data-event-chat-empty': '' }, [S.w45gc.empty])]))
      thread.scrollTop = thread.scrollHeight
      note.textContent = !inIt ? S.w45gc.notIn : left ? S.w45gc.leftNote : ''
      compose.hidden = !inIt || left
      leaveBox.replaceChildren(...(inIt && !host ? [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-event-chat-leave': left ? 'rejoin' : 'leave', onclick: () => { void chat.leave(id, !left) } }, [el('u', {}, [left ? S.w45gc.rejoin : S.w45gc.leave])])] : []))
      chat.markRead(id)
    }
    shown = { id, root, draw }
    draw()
    d.openSheet([root])
    void chat.retry(id)
  }

  return { ...chat, open }
}
