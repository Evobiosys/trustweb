// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 4): what the event page asks of the app (main.ts hands in the few app functions): the community's name, open that community,
 * choose the Community view for a community event, the event's Resources (event mode + Resources), and "Message everyone", which since wave45
 * event-group-chat opens the event's ONE shared thread (the earlier fan-out into each person's chat: DEVLOG/wave45/archive/event-group-chat).
 * The same functions serve the registry actions behind MCP event_chat_open, event_chat_send and event_message_all (a44d_actions.ts).
 */
import type { ColourTag } from './colour_tags'
import type { AppState, TwEvent } from './model'
import { setEventFilter } from './event_filter_mode'
import { setEveryone } from './event_bubble' // wave46 answers-45b
import { openBulkInvite } from './bulk_invite_view' // wave45 bulk-invite-filter
import { parseCommunity } from './ext/community-mighty/community_data'

export interface EventHostDeps {
  st: () => AppState
  save: () => void
  tags: () => readonly ColourTag[]
  openSheet: (body: (Node | null)[]) => void
  closeSheet: () => void
  toast: (text: string) => void
  /** wave45 event-group-chat: the event's shared thread (event_group_chat_view.ts open, event_group_chat.ts send). */
  groupChat: { open: (id: string) => void; send: (id: string, text: string) => Promise<unknown> }
  /** The Community view with that community chosen. */
  showCommunity: () => void
  /** The Personal | Community switch set to Community (this session). */
  chooseCommunity: () => void
  showResources: () => void
  /** wave46 answers-45b: the Web screen. */
  showWeb: () => void
}

export function eventPageHooks(d: EventHostDeps) {
  const communityName = (tag: string): string => d.tags().find((t) => t.id === tag)?.label ?? parseCommunity(d.st().extData?.['community-mighty']).meta?.[tag]?.name ?? tag
  const find = (id: string): TwEvent => {
    const ev = d.st().events?.find((e) => e.id === id || e.name.toLowerCase() === id.toLowerCase())
    if (!ev) throw new Error(`no event "${id}"`)
    return ev
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
    /** wave45 event-group-chat: "Message everyone" / Event chat opens the event's ONE shared thread (the fan-out into each person's chat is archived). */
    messageAll: (ev: TwEvent): void => d.groupChat.open(ev.id),
    inviteMany: (ev: TwEvent, done: () => void): void => openBulkInvite(ev, d, done),
    eventResources: (ev: TwEvent): void => { setEventFilter(d.st(), ev.id); d.save(); d.showResources() },
    /** wave46 answers-45b: "Web: just people from this event" = event mode on this event with the bubble on (a lift by Everyone ends), then the Web. */
    webBubble: (ev: TwEvent): void => { const s = d.st(); setEventFilter(s, ev.id); setEveryone(s, false); d.save(); d.showWeb() },
    /** Registry (MCP): open the event's shared chat; send one message into it (1 = kept and sent or waiting, 0 = refused). */
    openEventChat: (id: string): void => d.groupChat.open(find(id).id),
    messageAllById: (id: string, text: string): Promise<number> => d.groupChat.send(find(id).id, text).then((item) => (item ? 1 : 0)),
  }
}
