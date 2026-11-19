// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 1, D-P02): the steps MCP queues for the open app because only the app can do them: answering an incoming ask (the card's
 * Share / Not now, the know tip with its optional "who has it", the "may I show you" yes / no; MCP ask_answer) and sending a chat message (MCP
 * chat_send). The host answers through the same decide() the card uses, so the reply keeps the card's rules and the uniform schedule (I3).
 */
import { bool, str, type Actions } from './actions'
import { S } from './strings'

export interface A44dActionHost {
  /** False when the ask is no longer open on this device. */
  answerAsk(qid: string, yes: boolean, note?: string, who?: string): boolean | Promise<boolean>
  sendChat(personId: string, text: string): Promise<boolean>
  /** Item 4, since wave45 event-group-chat: the event's ONE shared chat; one message into it (1 kept, 0 refused). */
  openEventChat(eventId: string): void
  messageAll(eventId: string, text: string): Promise<number>
  /** wave45 event-group-chat: leave (true) or rejoin (false) the event's chat. */
  leaveEventChat(eventId: string, leave: boolean): Promise<boolean>
}

export function defineA44dActions(reg: Actions, host: A44dActionHost): void {
  reg.define({
    type: 'ask-answer', doc: 'Answers an incoming ask as its card does: yes or no; a know card takes the tip (note) and optionally who has it.',
    shape: '{"qid": ask id, "yes": true|false, "note"?: text, "who"?: name}',
    parse: (a) => ({ qid: str(a, 'qid', 120) as string, yes: bool(a, 'yes'), note: str(a, 'note', 200, true), who: str(a, 'who', 80, true) }),
    label: () => S.a44d.askAnswerLabel,
    apply: (a) => { void host.answerAsk(a.qid, a.yes, a.note, a.who) },
    undoable: false,
  })
  reg.define({
    type: 'chat-send', doc: 'Sends a chat message to a connected person.', shape: '{"person": person id, "text": message}',
    parse: (a) => ({ person: str(a, 'person', 120) as string, text: str(a, 'text', 4000) as string }),
    label: () => S.a44d.chatSendLabel,
    apply: (a) => { void host.sendChat(a.person, a.text) },
    undoable: false,
  })
  /* item 4: the event chat (Message everyone) */
  reg.define({
    type: 'event-chat-open', doc: 'Opens the shared chat of an event (one thread for the hosts and the people joining).', shape: '{"event": event id or name}',
    parse: (a) => ({ event: str(a, 'event', 120) as string }),
    label: () => S.a44d.chatOpenLabel,
    apply: (a) => host.openEventChat(a.event),
    undoable: false,
  })
  reg.define({
    type: 'event-message-all', doc: 'Sends one message into the shared chat of an event (same as event-chat-send; kept for older callers).', shape: '{"event": event id or name, "text": message}',
    parse: (a) => ({ event: str(a, 'event', 120) as string, text: str(a, 'text', 2000) as string }),
    label: () => S.a44d.messageAllLabel,
    apply: (a) => { void host.messageAll(a.event, a.text) },
    undoable: false,
  })
  /* wave45 event-group-chat */
  reg.define({
    type: 'event-chat-send', doc: 'Sends one message into the shared chat of an event (everyone at it reads the same thread).', shape: '{"event": event id, "text": message}',
    parse: (a) => ({ event: str(a, 'event', 120) as string, text: str(a, 'text', 2000) as string }),
    label: () => S.w45gc.sendLabel,
    apply: (a) => { void host.messageAll(a.event, a.text) },
    undoable: false,
  })
  reg.define({
    type: 'event-chat-leave', doc: 'Leaves the shared chat of an event (leave true), or joins it again (leave false); the others are told.', shape: '{"event": event id, "leave": true|false}',
    parse: (a) => ({ event: str(a, 'event', 120) as string, leave: bool(a, 'leave') }),
    label: () => S.w45gc.leaveLabel,
    apply: (a) => { void host.leaveEventChat(a.event, a.leave) },
    undoable: false,
  })
}
