// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat: MCP parity for an event's ONE shared thread (apps/trustweb/src/event_group_chat.ts). event_chat_read reads the stored
 * thread (record field `eventChats`); event_chat_send and event_chat_leave queue the registry actions 'event-chat-send' / 'event-chat-leave' for the
 * open app, which alone holds the pair keys that seal each item (event_chat_open lives in a44d_tools.ts).
 */
import { announce } from './events.ts'
import { load, needText, schema, S, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
/** EVENT_CHAT_TEXT_MAX (apps/demo types.ts). */
const TEXT_MAX = 2000
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
interface Ev { id: string; name: string }
interface Item { m: string; k: string; by: string; ts: number; text?: string; mine?: boolean; state?: string }
interface Thread { items?: Item[]; unread?: number; mem?: Record<string, { on: boolean }> }

function findEvent(r: Rec, q: unknown): Ev {
  const key = needText(q, 'event')
  const all = list<Ev>(r.events)
  const e = all.find((x) => x.id === key) ?? all.find((x) => typeof x.name === 'string' && x.name.toLowerCase() === key.toLowerCase())
  if (!e) throw new Error(`no event "${key}"`)
  return e
}
const threadOf = (r: Rec, id: string): Thread => ((r.eventChats as Record<string, Thread> | undefined)?.[id] ?? {})

export function eventChatTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const queue = (tool: string, type: string, args: Obj): void => announce(o.file, { at: now().toISOString(), kind: 'action', tool, summary: `${type} ${JSON.stringify(args)}`.slice(0, 200), action: { type, args } })
  const read: Tool[] = [{
    name: 'event_chat_read', description: 'The shared chat of an event (one thread for the hosts and the people joining), oldest first: kind (msg / join / leave), author, text, time, mine, waiting (not yet delivered); unread count; whether I left it.',
    inputSchema: schema({ event: S('event id or exact name') }, ['event']),
    run: (a) => {
      const r = load(o.file)
      const e = findEvent(r, a.event)
      const t = threadOf(r, e.id)
      const items = list<Item>(t.items).slice().sort((x, y) => x.ts - y.ts)
      return {
        event: e.id, name: e.name, unread: typeof t.unread === 'number' ? t.unread : 0, left: t.mem?.me?.on === false,
        items: items.map((i) => ({ kind: i.k, by: i.by, text: i.text ?? '', at: new Date(i.ts).toISOString(), mine: i.mine === true, waiting: i.mine === true && i.state === 'pending' })),
      }
    },
  }]
  if (!o.write) return read
  return [...read,
    {
      name: 'event_chat_send', description: 'Send one message into the shared chat of an event (everyone at it reads the same thread). Queued for the open TrustWeb app, which seals it per member.',
      inputSchema: schema({ event: S('event id or exact name'), text: S('the message') }, ['event', 'text']),
      run: (a) => {
        const e = findEvent(load(o.file), a.event)
        const text = needText(a.text, 'text')
        if (text.length > TEXT_MAX) throw new Error('text is too long')
        queue('event_chat_send', 'event-chat-send', { event: e.id, text })
        return { queued: true, event: e.id }
      },
    },
    {
      name: 'event_chat_leave', description: 'Leave the shared chat of an event (leave true: nothing new reaches me) or join it again (leave false); the others are told. Queued for the open TrustWeb app.',
      inputSchema: schema({ event: S('event id or exact name'), leave: { type: 'boolean', description: 'true = leave, false = join again' } }, ['event', 'leave']),
      run: (a) => {
        const e = findEvent(load(o.file), a.event)
        if (typeof a.leave !== 'boolean') throw new Error('leave must be true or false')
        queue('event_chat_leave', 'event-chat-leave', { event: e.id, leave: a.leave })
        return { queued: true, event: e.id, leave: a.leave }
      },
    },
  ]
}
