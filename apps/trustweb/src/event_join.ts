// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b event-qr-join: the short event QR, where a scanned or pasted event link opens, what follows a connect, and one person's open asks.
 * Pure and DOM-free.
 */
import { decodeEventLink, shortFields } from './event_link'
import type { HeldAsk } from './model'
import { liveHeldAsks } from './held_asks'

/** The event code stays within this many characters (QR version 16 at level M, 450 bytes); qr_modes.ts enforces it through shortEventLink's room. The connect part alone is ~276 chars, which leaves ~170 for the event; the handover's 400 (v15) is not reachable with two host names and the server id. */
export const EVENT_QR_MAX = 450

/** Decision switch (Jakob has not answered): true = the code carries only an id and the server resolves it. Needs the organizer to publish event fields; the hook only, no server part. */
export const EVENT_QR_SERVER_LOOKUP = false

/** The event link cut to what the code may carry: id, name, dates, core time, hosts' names (short form `#evs=`), the event-only mode and the tag name.
 * Place, conditions, themes, organizer and the sender stay out (the connect link already names the sender); they travel only with the event link (review 43b: no sync after the connect yet, D-line).
 * `room`: the characters the event part may take (EVENT_QR_MAX minus the connect part); over it the hosts go first, then the name is shortened. */
export function shortEventLink(eventLink: string, room = Infinity): string {
  const at = eventLink.indexOf('#')
  const ev = at < 0 ? null : decodeEventLink(eventLink.slice(at))
  if (!ev) return eventLink
  const build = (e: typeof ev): string => `${eventLink.slice(0, at)}#${e.kind === 'host' ? 'evs_host' : 'evs'}=${shortFields(e)}${e.srv ? `&srv=${e.srv}` : ''}`
  let out = build(ev)
  if (out.length <= room) return out
  const bare = { ...ev, hosts: undefined }
  out = build(bare)
  // Shorten the name a character at a time until it fits (never below NAME_MIN characters); base64 makes the length step uneven.
  for (let n = ev.name.length - 1; out.length > room && n >= NAME_MIN; n--) out = build({ ...bare, name: `${ev.name.slice(0, n).trimEnd()}…` })
  return out
}
const NAME_MIN = 12

export { eventLinkView } from './event_roles'

/** What opens when the connect flow after a scan ends (its add sheet with the ring choice is done): an event waiting, else the share, else the person's card. A share waits for no one. */
export function afterConnect(o: { hasShare: boolean; hasEvent: boolean }): 'share' | 'event' | 'person' {
  return o.hasShare ? 'share' : o.hasEvent ? 'event' : 'person'
}

/** The asks from one connection that nobody has decided yet (a yes already given is not open), newest first: answerable late. */
export function pastAsksOf(held: unknown, peerId: string, now: number): HeldAsk[] {
  return liveHeldAsks(held, now).filter((h) => h.peerId === peerId && h.yesAt === undefined).sort((a, b) => b.receivedAt - a.receivedAt)
}
