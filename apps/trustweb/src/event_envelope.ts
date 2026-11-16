// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (eta): the full event after a QR connect, without a server. The event QR carries only id, name, dates and hosts
 * (event_join.ts); the person who shows it still holds the whole event on their device. So, right after the connect:
 *   - the shower's device sends the new peer a sealed `event` envelope with the event link (place, conditions, themes, organizer);
 *   - the scanner's device asks the shower for the event (`want`) and retries a few times while the event is incomplete;
 *   - whatever arrives fills the EMPTY fields of the event the scanner holds or is about to open; nothing the scanner has is overwritten.
 * Nobody receives an event they did not show: an answer needs a QR shown within EVENT_SHOW_WINDOW_MS or an event the answerer hosts.
 * EVENT_QR_SERVER_LOOKUP (event_join.ts) stays false. The wire part is apps/demo/src/wire.ts (EventEnvelope). Pure; the host gives state and I/O.
 */
import type { EventEnvelope } from '../../demo/src/types'
import { decodeEventLink } from './event_link'
import type { LinkedEvent } from './event_link'
import { isEventHost } from './event_roles'
import { addItem } from './notify_inbox'
import { announceDue, communityOfEvent, noteShow, visibilityOf } from './event_visibility'
import { S } from './strings'
import type { AppState, TwEvent } from './model'

/** How long after showing the event QR a new connection gets the event (a scan follows the show within minutes). */
export const EVENT_SHOW_WINDOW_MS = 10 * 60_000
/** The scanner asks again after these delays while the event stays incomplete (the shower may be a moment late). */
export const EVENT_WANT_RETRY_MS: readonly number[] = [5_000, 30_000, 120_000]

/** The short QR leaves the place out; an event without one is still waiting for the rest. */
export const isIncomplete = (ev: { where: string }): boolean => ev.where === ''

type Fillable = Partial<Pick<TwEvent, 'where' | 'conditions' | 'themes' | 'organizer' | 'hosts' | 'to' | 'core'>>
const FILL: readonly (keyof Fillable)[] = ['where', 'conditions', 'themes', 'organizer', 'hosts', 'to', 'core']
const empty = (v: unknown): boolean => v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** Copies into `target` what it lacks from `src`; true when anything changed. */
export function fillEvent(target: Fillable, src: Fillable): boolean {
  let changed = false
  for (const k of FILL) {
    if (empty(target[k]) && !empty(src[k])) { (target as Record<string, unknown>)[k] = src[k]; changed = true }
  }
  return changed
}

/** May this device give the event `id` to a peer: it holds it and either showed its QR within the window or is one of its hosts, organizers or tech support. */
export function mayAnswer(s: Pick<AppState, 'events' | 'me' | 'people'>, id: string, shown: { id: string; at: number } | null, now: number): boolean {
  const ev = s.events?.find((e) => e.id === id)
  if (!ev) return false
  return (shown?.id === id && now - shown.at <= EVENT_SHOW_WINDOW_MS) || isEventHost(ev, s.me.displayName, s.people)
}

/**
 * Wave 44 steer-event-visibility: an event the host shared with the whole community arrives as a link envelope marked `announce`.
 * It becomes an event of mine I am not attending, plus one row in the notification inbox (bell badge, Events section), unless the event is known already.
 * Only a person I am connected to can send it (the envelope is sealed per peer). True when something was added.
 */
export function receiveAnnounce(s: Pick<AppState, 'events' | 'notifInbox'>, ev: LinkedEvent, from: string, now: number): boolean {
  if (s.events?.some((e) => e.id === ev.id)) return false
  const { kind: _kind, ...rest } = ev
  s.events = [...(s.events ?? []), { ...rest, createdAt: now, attended: false, fromLink: true }]
  const hosts = ev.hosts?.join(', ') ?? ''
  s.notifInbox = addItem(s.notifInbox ?? [], { id: `announce:${ev.id}`, kind: 'event', title: S.w44vis.announceTitle(ev.name), body: S.w44vis.announceBody(from, hosts), at: now, seenAt: null, eventId: ev.id })
  return true
}

export interface EnvelopeHost<P extends { id: string }> {
  state(): Pick<AppState, 'events' | 'me' | 'people'> & Partial<Pick<AppState, 'notifInbox'>>
  /** Wave 44: the connected peers of the people who carry this community tag (the ones an announce goes to). */
  members?(tag: string): P[]
  save(): void
  now(): number
  /** The event as an event link, the way the event QR page makes it (names hidden as the event's reveal setting says). */
  link(ev: TwEvent): string
  send(peer: P, env: EventEnvelope): Promise<void>
  /** The event the scanned link named, still waiting in the join sheet. */
  pending(): LinkedEvent | null
  setPending(ev: LinkedEvent | null): void
  /** An event this device holds just got more fields: redraw. */
  changed(): void
  later(fn: () => void, ms: number): void
}

export type EnvelopeOutcome = 'answered' | 'filled' | 'pending' | 'ignored'

export function createEventEnvelopes<P extends { id: string }>(host: EnvelopeHost<P>) {
  let shown: { id: string; at: number } | null = null
  const held = (id: string): TwEvent | undefined => host.state().events?.find((e) => e.id === id)
  const waiting = (id: string): boolean => { const e = held(id) ?? (host.pending()?.id === id ? host.pending() : null); return !!e && isIncomplete(e) }

  async function giveTo(peer: P, id: string): Promise<boolean> {
    const ev = held(id)
    if (!ev || !mayAnswer(host.state(), id, shown, host.now())) return false
    await host.send(peer, { v: 1, t: 'event', link: host.link(ev), show: visibilityOf(ev) })
    return true
  }

  return {
    /** The event QR of this event is on screen now. */
    shown(id: string, at: number = host.now()): void { shown = { id, at } },
    /** Debug (MCP event_envelope_send, approved on a card): the event to one person now, whatever the QR window says. */
    async sendNow(peer: P, id: string): Promise<void> {
      const ev = held(id)
      if (!ev) throw new Error(`no event "${id}"`)
      await host.send(peer, { v: 1, t: 'event', link: host.link(ev) })
    },
    /** Wave 44: every event the host shares with the whole community and has not announced yet goes to the community's connected members, once. True when one went out (the caller saves). */
    announceDue(): boolean {
      const due = (host.state().events ?? []).filter(announceDue)
      for (const ev of due) {
        ev.announcedAt = host.now()
        const link = host.link(ev)
        for (const peer of host.members?.(communityOfEvent(ev) ?? '') ?? []) void host.send(peer, { v: 1, t: 'event', link, show: visibilityOf(ev), announce: true }).catch(() => undefined)
      }
      return due.length > 0
    },
    /** The shower: someone just connected through this device's code; they get the event when its QR was just shown. */
    async connected(peer: P): Promise<void> {
      if (shown && host.now() - shown.at <= EVENT_SHOW_WINDOW_MS) await giveTo(peer, shown.id).catch(() => undefined)
    },
    /** The scanner: the connect completed; ask the shower for the event the link named, again later while it is incomplete. */
    async afterConnect(peer: P): Promise<void> {
      const p = host.pending()
      if (!p || !isIncomplete(p)) return
      const ask = async (): Promise<void> => { if (waiting(p.id)) await host.send(peer, { v: 1, t: 'event', want: p.id }).catch(() => undefined) }
      await ask()
      EVENT_WANT_RETRY_MS.forEach((ms) => host.later(() => { void ask() }, ms))
    },
    /** A sealed event envelope from a connected peer. */
    async onEnvelope(peer: P, env: EventEnvelope): Promise<EnvelopeOutcome> {
      if (env.want !== undefined) return (await giveTo(peer, env.want).catch(() => false)) ? 'answered' : 'ignored'
      const linked = env.link === undefined ? null : decodeEventLink(env.link.slice(Math.max(0, env.link.indexOf('#'))))
      if (!linked) return 'ignored'
      const who = host.state().people.find((p) => p.peerId === peer.id)
      if (who && env.show) { noteShow(who, linked.id, env.show); host.save() }   // wave 44: how they show at this event
      if (env.announce && who && receiveAnnounce(host.state() as Pick<AppState, 'events' | 'notifInbox'>, linked, who.name, host.now())) { host.save(); host.changed(); return 'filled' }
      const mine = held(linked.id)
      if (mine) {
        if (!fillEvent(mine, linked)) return 'ignored'
        host.save()
        host.changed()
        return 'filled'
      }
      const p = host.pending()
      if (p && p.id === linked.id && fillEvent(p, linked)) { host.setPending({ ...p }); return 'pending' }
      return 'ignored'
    },
  }
}
