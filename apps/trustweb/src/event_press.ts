// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-press-share: the device-local settings of an event (invite policy, notifications, offers, name reveal) and its times.
 * Pure, with type-only imports, so apps/mcp loads it under plain node (events.ts cannot: it imports without extensions).
 */
import type { TwEvent } from './model.ts'

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

export function validDate(v: string): boolean {
  return DATE.test(v) && !Number.isNaN(new Date(v.length === 10 ? `${v}T00:00` : v).getTime())
}

/** "2026-10-12" starts at 00:00; as an end it lasts until 23:59. */
export function stamp(v: string, end: boolean): string {
  return v.length === 10 ? `${v}T${end ? '23:59' : '00:00'}` : v
}

export type TimesError = 'from' | 'to' | 'core'

/** The first of from, to, core time that fails (the core days sit inside from..to; both ends or none). */
export function timesError(from: string, to: string | undefined, core: { from: string; to: string } | undefined): TimesError | undefined {
  if (!validDate(from)) return 'from'
  if (to && (!validDate(to) || stamp(to, true) < stamp(from, false))) return 'to'
  if (core && !(validDate(core.from) && validDate(core.to) && core.from <= core.to && stamp(core.from, false) >= stamp(from, false) && (!to || stamp(core.to, true) <= stamp(to, true)))) return 'core'
  return undefined
}

/** Wave 43: change when I am there (staying longer). The first field that fails leaves the event as it was; an empty `to` removes it; a core time that no longer fits goes. */
export function setEventTimes(ev: TwEvent, from: string, to: string): TimesError | undefined {
  const [f, t] = [from.trim(), to.trim()]
  const bad = timesError(f, t, undefined)
  if (bad) return bad
  if (timesError(f, t, ev.core) === 'core') delete ev.core
  ev.from = f
  if (t) ev.to = t; else delete ev.to
  return undefined
}

/** E3: how much of my name an event link of mine tells the other attendees. Set per event on this device; never in a link itself. */
export type NameReveal = 'full' | 'first' | 'hidden' | 'nick'
export const NAME_REVEALS: readonly NameReveal[] = ['full', 'first', 'hidden', 'nick']
/** Keeps today's behaviour: the display name as typed. */
export const DEFAULT_NAME_REVEAL: NameReveal = 'full'
export const nameRevealOf = (ev: Pick<TwEvent, 'nameReveal'>): NameReveal => (NAME_REVEALS.includes(ev.nameReveal as NameReveal) ? ev.nameReveal! : DEFAULT_NAME_REVEAL)

/** Who may invite others to an event. */
export type InvitePolicy = 'hosts' | 'trusted' | 'everyone'
export const INVITE_POLICIES: readonly InvitePolicy[] = ['hosts', 'trusted', 'everyone']
export const DEFAULT_INVITE_POLICY: InvitePolicy = 'hosts'

/** What the host switches on for this event. All off by default (Jakob may flip it here). */
export interface EventOffers { support: boolean; resources: boolean; feed: boolean }
export const EVENT_OFFERS_DEFAULT: Readonly<EventOffers> = { support: false, resources: false, feed: false }
export const offersOf = (ev: Pick<TwEvent, 'offers'>): EventOffers => ({ ...EVENT_OFFERS_DEFAULT, ...ev.offers })
/** The event-feed row asks this. */
export const eventOffersFeed = (ev: Pick<TwEvent, 'offers'>): boolean => offersOf(ev).feed

/** What the app and MCP change on an event on this device; a default value is not stored. Throws on a value outside the choices. */
export interface EventSettingsPatch { invitePolicy?: string; notify?: boolean; offers?: Partial<EventOffers>; nameReveal?: string }
export function applyEventSettings(ev: TwEvent, p: EventSettingsPatch): void {
  if (p.invitePolicy !== undefined) {
    if (!INVITE_POLICIES.includes(p.invitePolicy as InvitePolicy)) throw new Error(`invitePolicy must be one of ${INVITE_POLICIES.join(', ')}`)
    if (p.invitePolicy === DEFAULT_INVITE_POLICY) delete ev.invitePolicy; else ev.invitePolicy = p.invitePolicy as InvitePolicy
  }
  if (p.nameReveal !== undefined) {
    if (!NAME_REVEALS.includes(p.nameReveal as NameReveal)) throw new Error(`nameReveal must be one of ${NAME_REVEALS.join(', ')}`)
    if (p.nameReveal === DEFAULT_NAME_REVEAL) delete ev.nameReveal; else ev.nameReveal = p.nameReveal as NameReveal
  }
  if (p.notify !== undefined) { if (p.notify) delete ev.notify; else ev.notify = false }
  if (p.offers) {
    const next = { ...offersOf(ev), ...Object.fromEntries(Object.entries(p.offers).filter(([k, v]) => k in EVENT_OFFERS_DEFAULT && typeof v === 'boolean')) }
    if (Object.values(next).some(Boolean)) ev.offers = next; else delete ev.offers
  }
}
