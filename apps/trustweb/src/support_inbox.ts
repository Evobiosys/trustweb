// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-support: the one list of every ask for support (mine, and the ones sent to me), cancelling my own, the target of an
 * intro ("at <name>" = a person, anything else = a free-text category such as "plumber") and the people whose skills match a category.
 * Pure, DOM-free.
 */
import type { Person } from './model'
import { SUPPORT_NOTE_MAX, SupportWindow, buildSupport, isOpen } from './support_ask'
import type { SupportAsk, SupportChip, SupportIn } from './support_ask'

export interface InboxRow {
  kind: 'mine' | 'theirs'
  id: string
  /** The sender's name (theirs). */
  who?: string
  chips: SupportChip[]
  note: string
  until: number
  /** Mine: how many I asked and how many said "here". */
  asked?: number
  answered?: number
}

interface InboxState { supportAsks?: SupportAsk[]; supportIn?: SupportIn[]; people: readonly Pick<Person, 'name' | 'peerId'>[] }

/** Open asks only, the one ending soonest first. Empty = nothing to show (the caller says so in words). */
export function inboxRows(s: InboxState, now: number): InboxRow[] {
  const mine = (s.supportAsks ?? []).filter((a) => isOpen(a, now) && !a.cancelled && !a.agent).map((a): InboxRow => ({ kind: 'mine', id: a.id, chips: a.chips, note: a.note, until: a.until, asked: a.to.length, answered: a.here.length }))
  const theirs = (s.supportIn ?? []).filter((a) => isOpen(a, now)).map((a): InboxRow => ({ kind: 'theirs', id: a.id, who: s.people.find((p) => p.peerId === a.peerId)?.name ?? '', chips: a.chips, note: a.note, until: a.until }))
  return [...mine, ...theirs].sort((a, b) => a.until - b.until)
}

/** Removes my ask; `cancelled` is what was removed (its `to` are the peers to tell), null when there was no such ask of mine. */
export function cancelAsk(asks: readonly SupportAsk[] | undefined, id: string, _now: number): { asks: SupportAsk[]; cancelled: SupportAsk | null } {
  const list = asks ?? []
  const cancelled = list.find((a) => a.id === id) ?? null
  return { asks: cancelled ? list.filter((a) => a !== cancelled) : [...list], cancelled }
}

/** The peer closed their ask: only their copy goes. */
export const applyCancel = (list: readonly SupportIn[] | undefined, id: string, peerId: string): SupportIn[] => (list ?? []).filter((a) => !(a.id === id && a.peerId === peerId))

export type IntroTarget = { kind: 'person'; name: string } | { kind: 'category'; category: string }

/** "at Anna" targets the person Anna; the default is an abstract category. */
export function parseIntroTarget(text: string): IntroTarget | null {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return null
  const at = /^at\s+(.+)$/i.exec(t)
  if (at) return { kind: 'person', name: at[1] }
  if (/^at$/i.test(t)) return null
  return { kind: 'category', category: t }
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Connected people whose tags, context or notes name the category (a plural or "-ing" still matches by its stem). */
export function skillMatches<T extends Pick<Person, 'peerId' | 'fields' | 'context' | 'lines'>>(people: readonly T[], category: string): T[] {
  const q = fold(category).trim()
  if (!q) return []
  const stem = q.length > 5 ? q.slice(0, -2) : q
  const hit = (x: string | undefined): boolean => !!x && fold(x).includes(stem)
  return people.filter((p) => p.peerId && (Object.entries(p.fields ?? {}).some(([k, v]) => String(v) === 'true' && hit(k)) || hit(p.context) || (p.lines ?? []).some((l) => hit(l.text))))
}

/** The ask that goes to the matching people: the category is its note. */
export const categoryAsk = (category: string, matched: readonly Pick<Person, 'peerId'>[], now: number, id: string): SupportAsk =>
  buildSupport({ chips: [], note: category.slice(0, SUPPORT_NOTE_MAX), window: SupportWindow.Week, ids: matched.flatMap((p) => (p.peerId ? [p.peerId] : [])) }, now, id)
