// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24: the rows of the Chat tab: one per person with a thread, newest message first. Pure, no DOM. */
import type { ChatBook } from './chat'

export interface ChatListPerson {
  id: string
  peerId?: string
  name: string
}

export interface ChatListRow {
  personId: string
  name: string
  last: string
  at: number
  unread: number
}

const LAST_MAX = 80

export function chatListRows(book: ChatBook | undefined, people: readonly ChatListPerson[]): ChatListRow[] {
  const rows: ChatListRow[] = []
  for (const p of people) {
    const t = p.peerId ? book?.[p.peerId] : undefined
    const m = t?.messages[t.messages.length - 1]
    if (!t || !m) continue
    rows.push({ personId: p.id, name: p.name, last: m.text.replace(/\s+/g, ' ').trim().slice(0, LAST_MAX), at: m.at, unread: t.unread })
  }
  return rows.sort((a, b) => b.at - a.at)
}
