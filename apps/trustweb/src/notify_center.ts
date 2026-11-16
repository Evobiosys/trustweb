// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b notify-center (A1, A3): what the bell's notifications page lists, in four sections, and its unread count. Built from what the record
 * already holds (chats, wants-to-connect, connections, the notification inbox); nothing new is stored but `notifReadAt`. Pure, no DOM (MCP reads it too).
 * Imports are types only: apps/mcp runs this file under plain node.
 */
import type { AppState, Person, Peer } from './model'

/** An inbox row about an event whose Notifications switch is off (43c). Same rule as event_notify.ts eventNotifies: this file runs under plain node (apps/mcp), which cannot load a value import without an extension. */
const quietEvent = (s: Pick<Src, 'events'>, i: { eventId?: string }): boolean => !!i.eventId && s.events?.find((e) => e.id === i.eventId)?.notify === false

/** "Newly added" in the chat list and the "Connected" section: people connected within this many days. */
export const NEWLY_ADDED_DAYS = 7
export const SECTIONS = ['messages', 'wants', 'connected', 'events'] as const
export type Section = (typeof SECTIONS)[number]
export type CenterAction = 'open-chat' | 'add' | 'open-card' | 'message' | 'open-event'
export interface CenterItem { id: string; section: Section; title: string; body: string; at: number; read: boolean; action: CenterAction; personId?: string; peerId?: string }
type Src = Pick<AppState, 'people'> & Partial<Pick<AppState, 'peers' | 'chats' | 'wantsToConnect' | 'notifInbox' | 'notifReadAt' | 'events'>>

/** Someone who reached out to me and is not sorted yet: drawn on the unsorted ring in the "wants to connect" colour (rings_layout.ts webSlot). */
export const wantsConnect = (p: Pick<Person, 'ring' | 'reachedOut'>): boolean => p.reachedOut === 'received' && p.ring === 'intending'

export interface NewlyAdded { personId: string; name: string; at: number }

/** People connected in the last NEWLY_ADDED_DAYS days (the edge counts), newest first. */
export function newlyAdded(people: readonly Pick<Person, 'id' | 'name' | 'peerId'>[], peers: readonly Pick<Peer, 'id' | 'connectedAt'>[], now: number): NewlyAdded[] {
  const since = now - NEWLY_ADDED_DAYS * 86_400_000
  const rows: NewlyAdded[] = []
  for (const p of people) {
    const at = peers.find((x) => x.id === p.peerId)?.connectedAt
    if (p.peerId && typeof at === 'number' && at >= since) rows.push({ personId: p.id, name: p.name, at })
  }
  return rows.sort((a, b) => b.at - a.at)
}

/** Every item of the four sections, newest first within a section; `read` once the person marked all read after it (or its inbox row is seen). */
export function centerItems(s: Src, now: number): CenterItem[] {
  const readAt = s.notifReadAt ?? 0
  const people = s.people ?? []
  const item = (i: Omit<CenterItem, 'read'>, seen = false): CenterItem => ({ ...i, read: seen || i.at <= readAt })
  const out: CenterItem[] = []
  for (const [peerId, t] of Object.entries(s.chats ?? {})) {
    const last = t.messages[t.messages.length - 1]
    if (!(t.unread > 0) || !last) continue
    const who = people.find((p) => p.peerId === peerId)
    out.push(item({ id: `msg:${peerId}`, section: 'messages', title: who?.name ?? s.peers?.find((x) => x.id === peerId)?.displayName ?? '', body: last.text, at: last.at, action: 'open-chat', personId: who?.id, peerId }))
  }
  for (const w of s.wantsToConnect ?? []) out.push(item({ id: `want:${w.peerId}`, section: 'wants', title: w.name, body: '', at: w.at, action: 'add', peerId: w.peerId }))
  for (const p of people) if (wantsConnect(p)) out.push(item({ id: `wantp:${p.id}`, section: 'wants', title: p.name, body: '', at: p.metAt, action: 'open-card', personId: p.id }))
  for (const r of newlyAdded(people, s.peers ?? [], now)) out.push(item({ id: `conn:${r.personId}`, section: 'connected', title: r.name, body: '', at: r.at, action: 'message', personId: r.personId }))
  for (const i of s.notifInbox ?? []) if (i.kind === 'event' && !quietEvent(s, i)) out.push(item({ id: `inbox:${i.id}`, section: 'events', title: i.title, body: i.body, at: i.at, action: 'open-event' }, i.seenAt !== null))
  return out.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || b.at - a.at)
}

/** The items of one section (all when none is named). */
export const listNotifications = (s: Src, section: Section | undefined, now: number): CenterItem[] => centerItems(s, now).filter((i) => !section || i.section === section)

export const unreadCount = (s: Src, now: number): number => centerItems(s, now).filter((i) => !i.read).length

/** "Mark all read" (long press on the bell, MCP): the bell's count goes to 0 and the popup's inbox rows count as seen. */
export function markAllRead(s: Pick<AppState, 'notifReadAt' | 'notifInbox'>, now: number): void {
  s.notifReadAt = now
  if (s.notifInbox) s.notifInbox = s.notifInbox.map((i) => (i.seenAt === null ? { ...i, seenAt: now } : i))
}
