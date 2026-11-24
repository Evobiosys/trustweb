// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c seen-through (Jakob λ, 2026-11-17): the three sources that fill Person.via (+ anonymous), so people I know only through a friend sit
 * outside my rings (rings_layout.ts isBeyond):
 *   event - a host introduces a person at an event I attend (event_envelope.ts, EventEnvelope.seen);
 *   intro - a friend answers my intro ask by introducing the person (net.ts, an answer item with `shown`);
 *   ask   - a friend answers my resource ask with "I know someone who has this" (net.ts, the same item flag).
 * The named person's own device decides: the friend's device asks them first (kind 'show'); no yes = a nameless bubble "someone via Lena".
 * The consent flag (`shown`) and the name that only travels with a yes (`who`) are the only new wire fields (I8: every hop consents).
 * No runtime imports, so apps/mcp loads it under plain node (people_seen_through_list).
 */
import type { SharedItem } from '../../demo/src/types'
import type { Person } from './model'

export type SeenSource = 'event' | 'intro' | 'ask'
/** The longest name a seen-through item carries (wire.ts VIA_NAME_MAX). */
export const SEEN_WHO_MAX = 40
/** The context of an intro answer's item (travels; the asker's card shows it), so the asker files it as an introduction, not as a tip. */
export const INTRO_CONTEXT = 'An introduction'
/** What a yes to a show ask shares (the friend's device only reads that it is a yes). */
export const SHOW_YES = 'yes'
export const SHOW_CONTEXT = 'show'

type People = { people: Person[] }

/** The item the friend's device adds to its answer: the name only with that person's yes. */
export function seenItem(text: string, context: string, when: string, who: string, shown: boolean): SharedItem {
  return { text, context, when, shown, ...(shown ? { who: who.trim().slice(0, SEEN_WHO_MAX) } : {}) }
}

/** An arriving item read for the flag (untrusted): null without a boolean `shown`; a name without a yes is dropped. */
export function readSeen(it: unknown): { text: string; context: string; shown: boolean; who?: string } | null {
  if (typeof it !== 'object' || it === null) return null
  const o = it as Record<string, unknown>
  if (typeof o.shown !== 'boolean') return null
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, 200) : ''
  const context = typeof o.context === 'string' ? o.context.slice(0, 80) : ''
  const who = o.shown && typeof o.who === 'string' ? o.who.trim().slice(0, SEEN_WHO_MAX) : ''
  return { text, context, shown: o.shown, ...(who ? { who } : {}) }
}

const alive = (p: Person): boolean => p.deleted_at === undefined
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface SeenInput { via: string; who?: string; shown: boolean; source: SeenSource; resource?: string; event?: string; tag?: string; now: number; id: string }

/**
 * Adds (or updates) the person `via` my friend told me about. Returns their id; undefined when `via` is nobody I know.
 * A name I already have in my web is that person (nothing changes). Without a yes nothing of the name is kept. A later yes names the
 * nameless one of the same friend, source, resource and event.
 */
export function addSeenThrough(s: People, x: SeenInput): string | undefined {
  const friend = s.people.find((p) => p.id === x.via && alive(p) && !p.via)
  if (!friend) return undefined
  const name = x.shown && x.who ? x.who.trim().slice(0, SEEN_WHO_MAX) : ''
  if (name) {
    const mine = s.people.find((p) => alive(p) && !p.via && same(p.name, name))
    if (mine) return mine.id
  }
  const seen = { source: x.source, at: x.now, ...(x.resource ? { resource: x.resource.slice(0, 200) } : {}), ...(x.event ? { event: x.event } : {}), ...(x.tag ? { tag: x.tag } : {}) }
  const sameSeen = (p: Person): boolean => p.seen?.source === x.source && p.seen?.resource === seen.resource && p.seen?.event === seen.event && p.seen?.tag === seen.tag
  const hit = s.people.find((p) => alive(p) && p.via === x.via && (name ? same(p.name, name) : p.anonymous === true && sameSeen(p)))
    ?? (name ? s.people.find((p) => alive(p) && p.via === x.via && p.anonymous === true && sameSeen(p)) : undefined)
  const other = hit ? undefined : name ? s.people.find((p) => alive(p) && p.via && same(p.name, name)) : undefined
  if (other) return other.id // the same name told by a second friend: one card
  if (hit) {
    hit.seen = { ...seen, ...(!seen.event && hit.seen?.event ? { event: hit.seen.event } : {}), ...(!seen.tag && hit.seen?.tag ? { tag: hit.seen.tag } : {}) } // wave46: a second source keeps the first
    if (name) { hit.name = name; delete hit.anonymous }
    return hit.id
  }
  s.people.push({ id: x.id, name, context: '', ring: 'none' as Person['ring'], metAt: x.now, lines: [], via: x.via, ...(name ? {} : { anonymous: true }), seen })
  return x.id
}

/** The asker's side: the flagged items of one connected friend's answer become people outside the rings. The ids added or updated. */
export function seenFromItems(s: People, peerId: string, items: unknown, resource: string, now: number, newId: () => string): string[] {
  const friend = s.people.find((p) => p.peerId === peerId && alive(p) && !p.via)
  if (!friend || !Array.isArray(items)) return []
  const out: string[] = []
  for (const it of items) {
    const r = readSeen(it)
    if (!r) continue
    const id = addSeenThrough(s, { via: friend.id, who: r.who, shown: r.shown, source: r.context === INTRO_CONTEXT ? 'intro' : 'ask', resource, now, id: newId() })
    if (id) out.push(id)
  }
  return out
}

export interface SeenRow { id: string; name: string; anonymous: boolean; via: string; viaName: string; source: SeenSource; resource?: string; event?: string; at: number }

/** Everyone I see only through a friend (MCP people_seen_through_list): nameless ones carry no name. */
export function seenThroughList(s: People): SeenRow[] {
  return s.people.filter((p) => alive(p) && typeof p.via === 'string' && p.via !== '').map((p) => ({
    id: p.id, name: p.anonymous ? '' : p.name, anonymous: p.anonymous === true, via: p.via as string,
    viaName: s.people.find((f) => f.id === p.via)?.name ?? '', source: p.seen?.source ?? 'intro',
    ...(p.seen?.resource ? { resource: p.seen.resource } : {}), ...(p.seen?.event ? { event: p.seen.event } : {}), at: p.seen?.at ?? p.metAt,
  }))
}
