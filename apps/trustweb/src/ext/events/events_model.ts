// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Events view's model. Pure, no DOM. Cards come from the Community view's builder (community_model.buildEvents);
 * this adds my RSVP (going / maybe, kept in my slice `AppState.extData['events-view']`, never changing the app's own event), the events-map
 * link and "share an event to a tag" (through the existing group post).
 */
import type { ColourTag } from '../../colour_tags'
import { addGroupPost } from '../../feed_sources'
import type { AppState, TwEvent } from '../../model'
import { buildEvents, safeUrl, type EventCard } from '../community-mighty/community_model'

export const MODULE_ID = 'events-view'
export type Rsvp = 'going' | 'maybe'

export interface EventsData {
  /** Where the events map lives (Andrew Hasse's map; the address is not known yet, so the user pastes it). */
  mapUrl?: string
  /** 'none' = an answer taken back (review wave 40: kept as a mark, so a sync with my other device does not bring the old answer back). */
  rsvp?: Record<string, Rsvp | 'none'>
}

/** Wave 40 small-ui-c: the events map shown until the user pastes another address. */
export const DEFAULT_MAP_URL = 'https://andrewalan11.github.io/regen-events-map/'

/** https only and no credentials; the normalised link or null. */
export function mapEmbedUrl(raw: string, selfOrigin?: string): string | null {
  const href = safeUrl(raw)
  if (!href) return null
  const u = new URL(href)
  if (selfOrigin && u.origin === selfOrigin) return null   // review wave 40: a page of this app in the frame would run with the app's own storage
  return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
}

/** Review wave 40: the stored map consent (the origin the person agreed to load) covers this address; the old global "1" asks again. */
export function mapConsentCovers(stored: string | null, src: string): boolean {
  if (!stored || stored === '1') return false
  try { return new URL(src).origin === stored } catch { return false }
}

export function parseEvents(raw: unknown): EventsData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: EventsData = {}
  if (typeof o.mapUrl === 'string' && mapEmbedUrl(o.mapUrl)) d.mapUrl = o.mapUrl
  if (o.rsvp && typeof o.rsvp === 'object') {
    const r = Object.entries(o.rsvp as Record<string, unknown>).filter((e): e is [string, Rsvp | 'none'] => e[1] === 'going' || e[1] === 'maybe' || e[1] === 'none')
    if (r.length) d.rsvp = Object.fromEntries(r)
  }
  return d
}

/** Two of my devices: answers join per event, the incoming one wins; the incoming map link wins. */
export function mergeEvents(mineRaw: unknown, theirsRaw: unknown): EventsData {
  const a = parseEvents(mineRaw)
  const b = parseEvents(theirsRaw)
  const out: EventsData = { ...a, ...b }
  if (a.rsvp || b.rsvp) out.rsvp = { ...a.rsvp, ...b.rsvp }
  return out
}

/** The same answer again clears it. */
export function setRsvp(d: EventsData, id: string, v: Rsvp): EventsData {
  const rsvp = { ...d.rsvp }
  rsvp[id] = rsvp[id] === v ? 'none' : v
  return { ...d, rsvp }
}

export interface EventItem extends EventCard { rsvp: Rsvp | null }

/** Upcoming soonest first, then past. My answer, else "going" for an event the app already marks as attended. */
export function buildEventList(events: readonly TwEvent[] | undefined, d: EventsData, now: number): EventItem[] {
  return buildEvents(events, now).map((c) => { const r = d.rsvp?.[c.id]; return { ...c, rsvp: r === 'none' ? null : r ?? (c.going ? 'going' : null) } })
}

export const eventShareText = (c: Pick<EventCard, 'name' | 'from' | 'to' | 'where'>): string =>
  [c.name, c.from + (c.to && c.to !== c.from ? ` – ${c.to}` : ''), c.where].filter(Boolean).join(' · ')

/** One group post to a tag I joined; false when I am not in that group. */
export function shareEventToTag(s: AppState, tags: readonly ColourTag[], c: Pick<EventCard, 'name' | 'from' | 'to' | 'where'>, tagId: string, now: number): boolean {
  return addGroupPost(s, `tag:${tagId}`, eventShareText(c), now, tags) !== null
}
