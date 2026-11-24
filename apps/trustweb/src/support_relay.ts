// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 46 iyg-ask-reach: an ask for support scoped to a community or an event reaches the people there I am not connected to, through
 * the host they ARE connected to: one hop. The host's device passes the same text on once; the answer ("I'm here") comes back the same way.
 * Pure and DOM-free.
 */
import { MAX_FANOUT } from './hops'
import { parseCommunity, isManager } from './ext/community-mighty/community_data.ts'
import { mayAnnounce } from './community_event_access.ts'
import { eventOrganizers, isEventHost } from './event_roles'
import { offersOf } from './event_press'
import { askPeers } from './non_responsive'
import { SCOPE_TEXT_MAX, SUPPORT_NOTE_MAX, VIA_PARAM, supportText } from './support_ask'
import type { AppState, Peer, Person, TwEvent } from './model'
import type { SupportAsk, SupportScope } from './support_ask'

type RelayState = Pick<AppState, 'people' | 'peers' | 'events' | 'extData' | 'me' | 'supportIn'>

/** The scope an ask carries: the community tag it is limited to and/or the event chip it includes. */
export function scopeOfFilter(f: { only?: string; add: readonly string[] }, label: (kind: 'tag' | 'event', id: string) => string): SupportScope | undefined {
  const event = f.add.find((c) => c.startsWith('event:'))?.slice(6)
  if (!f.only && !event) return undefined
  return { ...(f.only ? { tag: f.only } : {}), ...(event ? { event } : {}), name: label(event ? 'event' : 'tag', (event ?? f.only) as string).slice(0, SCOPE_TEXT_MAX) }
}

/** The connected people the event names as hosts or organizers (by person id or name): the ask must reach them, they pass it on. */
export function eventHostPeople(s: Pick<AppState, 'people' | 'events'>, eventId: string): Person[] {
  const ev = (s.events ?? []).find((e) => e.id === eventId)
  const refs = [...(ev?.hosts ?? []), ...(ev ? eventOrganizers(ev) : [])].map((r) => r.trim().toLowerCase())
  return s.people.filter((p) => p.deleted_at === undefined && p.peerId && (refs.includes(p.id.toLowerCase()) || refs.includes(p.name.trim().toLowerCase())))
}

/** wave46 iyg-event-ask: the event page offers "Ask the people here for support" when the host switched it on (my own event), or when I attend an event I joined by link/QR and a host I am connected to can pass the ask on: a guest copy never held the host's switch, and the host decides whether to relay (relayPeers). */
export const canAskHere = (s: Pick<AppState, 'people' | 'events'>, ev: Pick<TwEvent, 'id' | 'offers' | 'attended' | 'fromLink' | 'hosts' | 'organizers'>): boolean =>
  offersOf(ev).support || (ev.attended && ev.fromLink === true && eventHostPeople(s, ev.id).length > 0)

/** wave46 iyg-assemble (G3b): the connected hosts of the events of a community (any ring): an ask limited to the community must reach them, they pass it on. */
export function communityHostPeople(s: Pick<AppState, 'people' | 'events'>, tag: string): Person[] {
  const ids = (s.events ?? []).filter((e) => (e.communityId ?? e.community) === tag).flatMap((e) => eventHostPeople(s, e.id).map((p) => p.id))
  return s.people.filter((p) => ids.includes(p.id))
}

/** wave46 iyg-reviewfix F9: the connected people who can actually pass an ask of this scope on (relayPeers on their device): the event's hosts for an event; the community's organizers for a community. */
export function relayHostPeople(s: Pick<AppState, 'people' | 'events' | 'extData'>, scope: { tag?: string; event?: string }): Person[] {
  if (scope.event) return eventHostPeople(s, scope.event)
  const organizers = scope.tag ? parseCommunity(s.extData?.['community-mighty']).meta?.[scope.tag]?.organizers ?? [] : []
  if (!organizers.length) return scope.tag ? communityHostPeople(s, scope.tag) : [] // a guest's phone often names no organizer: then the hosts of the community's events are the best I know
  return s.people.filter((p) => p.deleted_at === undefined && p.peerId && organizers.includes(p.id))
}

/** wave46 iyg-reviewfix D3: the text of my ask for one recipient: the scope's NAME (an event or community label) only when that person is inside the scope; others get the ids without it. */
export function supportTextFor(appUrl: string, s: Pick<AppState, 'people' | 'events'>, ask: Pick<SupportAsk, 'id' | 'chips' | 'note' | 'until' | 'scope'>, to: Person): string {
  const sc = ask.scope
  if (!sc?.name) return supportText(appUrl, ask)
  const ev = sc.event ? (s.events ?? []).find((e) => e.id === sc.event) : undefined
  const inside = (sc.tag !== undefined && String(to.fields?.[sc.tag]) === 'true') || (!!sc.event && (!!to.events?.includes(sc.event) || !!ev?.people?.includes(to.id) || (!!ev && eventHostPeople(s, ev.id).some((p) => p.id === to.id))))
  if (inside) return supportText(appUrl, ask)
  const { name: _name, ...rest } = sc
  return supportText(appUrl, { ...ask, scope: rest })
}

/** The peers this device passes an incoming scoped ask on to; empty unless I host/announce the scope, the sender belongs to it, and the ask is new and not relayed already. */
export function relayPeers(s: RelayState, ask: { id: string; scope?: SupportScope }, senderPeerId: string): Peer[] {
  const scope = ask.scope
  if (!scope || scope.relayed || (s.supportIn ?? []).some((a) => a.id === ask.id)) return []
  const live = s.people.filter((p) => p.deleted_at === undefined)
  let inScope: (p: Person) => boolean
  const ev = scope.event ? (s.events ?? []).find((e) => e.id === scope.event) : undefined
  if (ev && isEventHost(ev, s.me.displayName, s.people) && !offersOf(ev).support) return []   // wave46 iyg-event-ask: the host who did not switch "Ask for support" on passes nothing on
  if (ev && isEventHost(ev, s.me.displayName, s.people)) inScope = (p) => !!ev.people?.includes(p.id) || !!p.events?.includes(ev.id)
  else if (scope.tag && isManager(parseCommunity(s.extData?.['community-mighty']), scope.tag) && mayAnnounce(s, scope.tag)) inScope = (p) => String(p.fields?.[scope.tag as string]) === 'true'
  else return []
  if (!live.some((p) => p.peerId === senderPeerId && inScope(p))) return []
  const open = new Set(askPeers(s).map((p) => p.id))
  const to = new Set(live.filter((p) => p.peerId && p.peerId !== senderPeerId && open.has(p.peerId) && inScope(p)).map((p) => p.peerId))
  return s.peers.filter((p) => to.has(p.id)).slice(0, MAX_FANOUT)
}

/** The text a relayed ask travels as: the same ask, marked relayed, with the asker's name. */
export function relayText(appUrl: string, ask: Pick<SupportAsk, 'id' | 'chips' | 'note' | 'until'> & { scope: SupportScope }, askerName: string): string {
  const from = askerName.slice(0, SCOPE_TEXT_MAX)
  return supportText(appUrl, { ...ask, note: `${from}: ${ask.note}`.slice(0, SUPPORT_NOTE_MAX), scope: { ...ask.scope, relayed: true, from } }) // F7: an old app ignores scope and shows the note: it names the asker there
}


/** A relayed receiver said "I'm here": the host passes it to the asker with the name. */
export const viaHereText = (appUrl: string, id: string, name: string): string => `${appUrl}?${VIA_PARAM}=${encodeURIComponent(JSON.stringify({ id, name: name.slice(0, SCOPE_TEXT_MAX) }))}`
export function parseViaHere(appUrl: string, text: string): { id: string; name: string } | null {
  const head = `${appUrl}?${VIA_PARAM}=`
  if (typeof text !== 'string' || !text.startsWith(head)) return null
  try {
    const o = JSON.parse(decodeURIComponent(text.slice(head.length))) as Record<string, unknown>
    return typeof o.id === 'string' && o.id && o.id.length <= 40 && typeof o.name === 'string' && o.name ? { id: o.id, name: o.name.slice(0, SCOPE_TEXT_MAX) } : null
  } catch { return null }
}
