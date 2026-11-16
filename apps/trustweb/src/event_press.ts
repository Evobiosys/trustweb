// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-press-share: the device-local settings of an event (invite policy, notifications, offers, name reveal) and its times.
 * Pure, with type-only imports, so apps/mcp loads it under plain node (events.ts cannot: it imports without extensions).
 */
import type { Me, TwEvent } from './model.ts'

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

/** Open decision (wave 43 questions, nickname source): the nickname is Me.nickname (mine, set on the event page); without one, a Nickname reveal shows 'first' (my first name) or 'hidden' (nothing). One-line switch, read by events.ts revealedBy. */
export const NICK_FALLBACK: 'first' | 'hidden' = 'first'

/** Who may invite others to an event. */
export type InvitePolicy = 'hosts' | 'trusted' | 'everyone'
export const INVITE_POLICIES: readonly InvitePolicy[] = ['hosts', 'trusted', 'everyone']
/** Jakob's answer (2026-11-15, gamma): everyone attending AND newly invited people may invite further. */
export const DEFAULT_INVITE_POLICY: InvitePolicy = 'everyone'

/** What the host switches on for this event. All off by default (Jakob may flip it here). */
export interface EventOffers { support: boolean; resources: boolean; feed: boolean }
export const EVENT_OFFERS_DEFAULT: Readonly<EventOffers> = { support: false, resources: false, feed: false }
export const offersOf = (ev: Pick<TwEvent, 'offers'>): EventOffers => ({ ...EVENT_OFFERS_DEFAULT, ...ev.offers })
/** The event-feed row asks this. */
export const eventOffersFeed = (ev: Pick<TwEvent, 'offers'>): boolean => offersOf(ev).feed

/** "https://Mastodon.Social/" or "mastodon.social" -> "mastodon.social"; undefined when it is no public host name. (fediverse.ts parseInstance is the strict check at fetch time; this leaf loads under plain node.) */
export function instanceHost(input: string): string | undefined {
  const host = input.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : undefined
}

/** Wave 44 steer-event-visibility: how I show to the other people at an event. open = in the attendee list; discoverable = only when searched or scanned; off = nowhere. */
export type EventVisibility = 'open' | 'discoverable' | 'off'
export const EVENT_VISIBILITIES: readonly EventVisibility[] = ['open', 'discoverable', 'off']
/** Jakob (steering 3): the default is discoverable. One constant. */
export const DEFAULT_EVENT_VISIBILITY: EventVisibility = 'discoverable'
export const isVisibility = (v: unknown): v is EventVisibility => EVENT_VISIBILITIES.includes(v as EventVisibility)
export const visibilityOf = (ev: Pick<TwEvent, 'showMe'>): EventVisibility => (isVisibility(ev.showMe) ? ev.showMe : DEFAULT_EVENT_VISIBILITY)

/** Sets my mode; the default is not stored. Throws on a value outside the choices. */
export function setShowMe(ev: TwEvent, v: string): void {
  if (!isVisibility(v)) throw new Error(`showMe must be one of ${EVENT_VISIBILITIES.join(', ')}`)
  if (v === DEFAULT_EVENT_VISIBILITY) delete ev.showMe; else ev.showMe = v
}

/** The host's suggestion a participant has not answered yet (one popup, once); undefined for the host, for no suggestion, and after the answer. */
export const hostDefaultPending = (ev: Pick<TwEvent, 'hostDefault' | 'hostDefaultAnswered'>, iAmHost: boolean): EventVisibility | undefined =>
  !iAmHost && !ev.hostDefaultAnswered && isVisibility(ev.hostDefault) ? ev.hostDefault : undefined

/** Keep = my mode becomes the host's suggestion; Change = my mode stays as it is (the person picks in Advanced). Either way it is asked once, and my own choice wins from then on. */
export function answerHostDefault(ev: TwEvent, answer: 'keep' | 'change'): void {
  if (answer === 'keep' && isVisibility(ev.hostDefault)) setShowMe(ev, ev.hostDefault)
  ev.hostDefaultAnswered = true
}

/** What the app and MCP change on an event on this device; a default value is not stored. Throws on a value outside the choices. */
export interface EventSettingsPatch { invitePolicy?: string; notify?: boolean; offers?: Partial<EventOffers>; nameReveal?: string; communityId?: string; myNickname?: string; mastodonInstance?: string; /** Wave 44 (43-D7): the host lets technical support take over. */ techTakeover?: boolean; /** Wave 44 steer-event-visibility: how I show at this event (open | discoverable | off). */ showMe?: string; /** Wave 44: the host shares the event with the whole community. */ shareCommunity?: boolean; /** Wave 44 steer-event-visibility-3: the host's suggested mode for participants. */ hostDefault?: string }

export function applyEventSettings(ev: TwEvent, p: EventSettingsPatch): void {
  if (p.invitePolicy !== undefined) {
    if (!INVITE_POLICIES.includes(p.invitePolicy as InvitePolicy)) throw new Error(`invitePolicy must be one of ${INVITE_POLICIES.join(', ')}`)
    if (p.invitePolicy === DEFAULT_INVITE_POLICY) delete ev.invitePolicy; else ev.invitePolicy = p.invitePolicy as InvitePolicy
  }
  if (p.nameReveal !== undefined) {
    if (!NAME_REVEALS.includes(p.nameReveal as NameReveal)) throw new Error(`nameReveal must be one of ${NAME_REVEALS.join(', ')}`)
    if (p.nameReveal === DEFAULT_NAME_REVEAL) delete ev.nameReveal; else ev.nameReveal = p.nameReveal as NameReveal
  }
  for (const k of ['communityId', 'myNickname'] as const) {
    const v = p[k]?.trim()
    if (p[k] === undefined) continue
    if (v) ev[k] = v; else delete ev[k]
  }
  if (p.mastodonInstance !== undefined) {
    const host = p.mastodonInstance.trim() ? instanceHost(p.mastodonInstance) : undefined
    if (p.mastodonInstance.trim() && !host) throw new Error('mastodonInstance must be a host name like mastodon.social, or empty')
    if (host) ev.mastodonInstance = host; else delete ev.mastodonInstance
  }
  if (p.notify !== undefined) { if (p.notify) delete ev.notify; else ev.notify = false }
  if (p.showMe !== undefined) setShowMe(ev, p.showMe)
  if (p.hostDefault !== undefined) {
    if (!isVisibility(p.hostDefault)) throw new Error(`hostDefault must be one of ${EVENT_VISIBILITIES.join(', ')}`)
    ev.hostDefault = p.hostDefault
  }
  if (p.shareCommunity !== undefined) { if (p.shareCommunity) ev.shareCommunity = true; else delete ev.shareCommunity }
  if (p.techTakeover !== undefined) { if (p.techTakeover) ev.techTakeover = true; else delete ev.techTakeover }
  if (p.offers) {
    const next = { ...offersOf(ev), ...Object.fromEntries(Object.entries(p.offers).filter(([k, v]) => k in EVENT_OFFERS_DEFAULT && typeof v === 'boolean')) }
    if (Object.values(next).some(Boolean)) ev.offers = next; else delete ev.offers
  }
}

/** Wave 43 answers (iota): my nicknames, first one first; the old single `nickname` still counts when `nicknames` was never set. */
export const nicknamesOf = (me: Pick<Me, 'nickname' | 'nicknames'>): string[] => me.nicknames ?? (me.nickname ? [me.nickname] : [])

/** Sets my nicknames (trimmed, no empties, no repeats); `nickname` keeps the first so older readers (the name reveal, links) still work. An empty list removes both. */
export function setNicknames(me: Pick<Me, 'nickname' | 'nicknames'>, list: readonly string[]): void {
  const next = [...new Set(list.map((n) => n.trim()).filter(Boolean))]
  if (next.length) { me.nicknames = next; me.nickname = next[0] } else { delete me.nicknames; delete me.nickname }
}

/** Once: an existing `nickname` becomes nicknames[0]. True when something changed. */
export function migrateNicknames(s: { me?: Pick<Me, 'nickname' | 'nicknames'> }): boolean {
  const me = s.me
  if (!me || me.nicknames !== undefined || !me.nickname?.trim()) return false
  me.nicknames = [me.nickname.trim()]
  return true
}

/** The nickname the Nickname reveal of an event shows: my nickname at this event, else my first nickname. */
export const nickFor = (me: Pick<Me, 'nickname' | 'nicknames'>, ev: Pick<TwEvent, 'myNickname'>): string | undefined => ev.myNickname?.trim() || nicknamesOf(me)[0]
