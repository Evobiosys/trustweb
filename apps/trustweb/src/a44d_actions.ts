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
  /** Item 4: the event's Message everyone composer; sending to everyone at it (how many it reached). */
  openEventChat(eventId: string): void
  messageAll(eventId: string, text: string): Promise<number>
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
    type: 'event-chat-open', doc: 'Opens Message everyone of an event (the composer whose text goes to every connected person at it).', shape: '{"event": event id or name}',
    parse: (a) => ({ event: str(a, 'event', 120) as string }),
    label: () => S.a44d.chatOpenLabel,
    apply: (a) => host.openEventChat(a.event),
    undoable: false,
  })
  reg.define({
    type: 'event-message-all', doc: 'Sends one message into the chat with every connected person at an event (the people joining and the hosts).', shape: '{"event": event id or name, "text": message}',
    parse: (a) => ({ event: str(a, 'event', 120) as string, text: str(a, 'text', 2000) as string }),
    label: () => S.a44d.messageAllLabel,
    apply: (a) => { void host.messageAll(a.event, a.text) },
    undoable: false,
  })
}
