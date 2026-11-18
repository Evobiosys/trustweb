// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 4): what the event page asks of the app (main.ts hands in the few app functions): the community's name, open that community,
 * choose the Community view for a community event, the event's Resources (event mode + Resources), and "Message everyone" (a composer whose text
 * goes into the chat with every connected person at the event). The same functions serve the registry actions behind MCP event_chat_open and
 * event_message_all (a44d_actions.ts).
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, TwEvent } from './model'
import { everyoneAt } from './event_community'
import { eventTagLabel } from './event_tag'
import { tagLabel } from './events'
import { setEventFilter } from './event_filter_mode'
import { parseCommunity } from './ext/community-mighty/community_data'
import { S } from './strings'

export interface EventHostDeps {
  st: () => AppState
  save: () => void
  tags: () => readonly { id: string; label?: string }[]
  openSheet: (body: (Node | null)[]) => void
  closeSheet: () => void
  toast: (text: string) => void
  send: (peerId: string, text: string) => Promise<boolean>
  /** The Community view with that community chosen. */
  showCommunity: () => void
  /** The Personal | Community switch set to Community (this session). */
  chooseCommunity: () => void
  showResources: () => void
}

export function eventPageHooks(d: EventHostDeps) {
  const communityName = (tag: string): string => d.tags().find((t) => t.id === tag)?.label ?? parseCommunity(d.st().extData?.['community-mighty']).meta?.[tag]?.name ?? tag
  const find = (id: string): TwEvent => {
    const ev = d.st().events?.find((e) => e.id === id || e.name.toLowerCase() === id.toLowerCase())
    if (!ev) throw new Error(`no event "${id}"`)
    return ev
  }
  /** Sends `text` to everyone at the event who is connected; how many it went to. */
  async function messageAllSend(ev: TwEvent, text: string): Promise<number> {
    const body = text.trim()
    if (!body) return 0
    const label = eventTagLabel(tagLabel(ev))
    let n = 0
    for (const p of everyoneAt(d.st(), ev)) if (p.peerId && (await d.send(p.peerId, S.a44d.messageAllText(label, body)).catch(() => false))) n++
    return n
  }
  function messageAll(ev: TwEvent): void {
    const label = eventTagLabel(tagLabel(ev))
    const to = everyoneAt(d.st(), ev)
    const area = el('textarea', { class: 'field', rows: '3', maxlength: '2000', placeholder: S.a44d.messageAllPh, 'aria-label': S.a44d.messageAllPh, 'data-event-message-text': '' }) as HTMLTextAreaElement
    const go = el('button', { class: 'btn btn-electric wide', type: 'button', 'data-event-message-send': '', disabled: !to.length, onclick: () => {
      void messageAllSend(ev, area.value).then((n) => { d.closeSheet(); d.toast(S.a44d.messageAllSent(n)) })
    } }, [S.a44d.messageAllSend])
    d.openSheet([
      el('h3', {}, [S.a44d.messageAllTitle(label)]),
      el('p', { class: 'meta' }, [to.length ? S.a44d.messageAllHint : S.a44d.messageAllNone]),
      el('div', { class: 'chips' }, to.map((p) => el('span', { class: 'chip' }, [p.name]))),
      area, go,
      el('button', { class: 'btn btn-ghost wide', type: 'button', onclick: d.closeSheet }, [S.close]),
    ])
  }
  return {
    communityName,
    openCommunity: (tag: string): void => {
      const s = d.st()
      s.extData = { ...s.extData, 'community-mighty': { ...(s.extData?.['community-mighty'] as object | undefined), tag } }
      d.save()
      d.chooseCommunity()
      d.showCommunity()
    },
    communityView: (_tag: string): void => d.chooseCommunity(),
    messageAll,
    eventResources: (ev: TwEvent): void => { setEventFilter(d.st(), ev.id); d.save(); d.showResources() },
    /** Registry (MCP): open the composer of an event; send to everyone at it. */
    openEventChat: (id: string): void => messageAll(find(id)),
    messageAllById: (id: string, text: string): Promise<number> => messageAllSend(find(id), text),
  }
}
