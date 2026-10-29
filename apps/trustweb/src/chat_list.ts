// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24: the rows of the Chat tab: one per person with a thread, newest message first. Pure, no DOM. */
import type { ChatBook } from './chat'
import { channelLink } from './channel'
import { Channel } from './model'

export interface ChatListPerson {
  id: string
  peerId?: string
  name: string
  /** The person's stored messenger values (Person.channels); only Signal and WhatsApp become symbols. */
  channels?: Partial<Record<Channel, string>>
}

export interface ChatListRow {
  personId: string
  name: string
  last: string
  at: number
  unread: number
}

const LAST_MAX = 80

export interface ChatListOptions {
  /** Filters by name and message text. */
  query?: string
  /** Do Not Disturb: no conversation is listed. */
  hidden?: boolean
}

const matches = (query: string | undefined, ...texts: string[]): boolean => {
  const q = (query ?? '').trim().toLowerCase()
  return !q || texts.some((x) => x.toLowerCase().includes(q))
}

export function chatListRows(book: ChatBook | undefined, people: readonly ChatListPerson[], { query, hidden }: ChatListOptions = {}): ChatListRow[] {
  const rows: ChatListRow[] = []
  if (hidden) return rows
  for (const p of people) {
    const t = p.peerId ? book?.[p.peerId] : undefined
    const m = t?.messages[t.messages.length - 1]
    if (!t || !m || !matches(query, p.name, ...t.messages.map((x) => x.text))) continue
    rows.push({ personId: p.id, name: p.name, last: m.text.replace(/\s+/g, ' ').trim().slice(0, LAST_MAX), at: m.at, unread: t.unread })
  }
  return rows.sort((a, b) => b.at - a.at)
}

export interface ChatPickerRow {
  personId: string
  name: string
  connected: boolean
}

/** The "New message" picker: people who can be chatted with (connected), by name; a typed name also finds the others, flagged. */
export function chatPickerRows(people: readonly ChatListPerson[], query?: string): ChatPickerRow[] {
  const typed = !!query?.trim()
  return people
    .filter((p) => matches(query, p.name) && (typed || p.peerId))
    .map((p) => ({ personId: p.id, name: p.name, connected: !!p.peerId }))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
}

/** "Find people to chat with": connected people with no conversation yet, by name. */
export function chatFindRows(book: ChatBook | undefined, people: readonly ChatListPerson[], query?: string): ChatPickerRow[] {
  return people
    .filter((p) => p.peerId && !book?.[p.peerId]?.messages.length && matches(query, p.name))
    .map((p) => ({ personId: p.id, name: p.name, connected: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface MessengerSymbol {
  kind: 'trustweb' | 'signal' | 'whatsapp'
  /** Absent for TrustWeb (the chat itself); the messenger's deep link otherwise. */
  href?: string
}

/** The messengers available with this person: TrustWeb when connected, Signal / WhatsApp when a value is stored. */
export function messengerSymbols(p: ChatListPerson): MessengerSymbol[] {
  const out: MessengerSymbol[] = p.peerId ? [{ kind: 'trustweb' }] : []
  for (const [kind, ch] of [['signal', Channel.Signal], ['whatsapp', Channel.WhatsApp]] as const) {
    const v = p.channels?.[ch]
    if (v) out.push({ kind, href: channelLink(ch, v) })
  }
  return out
}
