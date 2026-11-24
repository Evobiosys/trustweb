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
import { mergeActivities } from './open_space'
import { mergePoll } from './open_space_poll'
import { addItem } from './notify_inbox'
import { announceDue, communityOfEvent, noteShow, visibilityOf } from './event_visibility'
import { S } from './strings'
import type { AppState, Person, TwEvent } from './model'
import { namedHost } from './event_conference'
import { addSeenThrough } from './seen_through' // wave44c seen-through
import { randomId } from '../../demo/src/crypto'
import { applyJoined } from './event_community' // wave44c answers-44d
import { createEventMerge } from './event_merge_flow' // wave45 merge-events
import { resolveEvent } from './event_merge'
import { mayAnnounce, seesEvent } from './community_event_access' // wave45 community-events-invite-only; answers-45a: seesEvent
import { REPLAY_GAP_MS } from './events_refetch' // wave45 events-refetch
import { communityRosterNames, rosterDue, rosterNames, rosterTags } from './event_roster' // wave46 iyg-roster

/** How long after showing the event QR a new connection gets the event (a scan follows the show within minutes). */
export const EVENT_SHOW_WINDOW_MS = 10 * 60_000
/** The scanner asks again after these delays while the event stays incomplete (the shower may be a moment late). */
/** At most this many names go to one peer in one run (a big community is told over several runs). */
const ROSTER_CAP = 60
export const EVENT_WANT_RETRY_MS: readonly number[] = [5_000, 30_000, 120_000]

/** The short QR leaves the place out; an event without one is still waiting for the rest. */
export const isIncomplete = (ev: { where: string }): boolean => ev.where === ''

type Fillable = Partial<Pick<TwEvent, 'where' | 'conditions' | 'themes' | 'organizer' | 'hosts' | 'to' | 'core' | 'showAll' | 'confHidden'>>
const FILL: readonly (keyof Fillable)[] = ['where', 'conditions', 'themes', 'organizer', 'hosts', 'to', 'core', 'showAll', 'confHidden']
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
  state(): Pick<AppState, 'events' | 'me' | 'people'> & Partial<Pick<AppState, 'notifInbox' | 'eventAlerts' | 'extData' | 'rosterSent'>>
  /** Wave 44: the connected peers of the people who carry this community tag (the ones an announce goes to). */
  members?(tag: string): P[]
  /** Wave 44 steer-open-space: the connected people at this event (tagged or invited): the schedule of an open space goes to them. */
  recipients?(ev: TwEvent): P[]
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
  /** Wave 44c event-autosave: my connected peers (the hosts an rsvp goes to, the guests a changed conference link goes to). */
  peers?(): P[]
}

export type EnvelopeOutcome = 'answered' | 'filled' | 'pending' | 'ignored'

export function createEventEnvelopes<P extends { id: string }>(host: EnvelopeHost<P>) {
  let shown: { id: string; at: number } | null = null
  const merge = createEventMerge(host) // wave45 merge-events
  const held = (id: string): TwEvent | undefined => host.state().events?.find((e) => e.id === id)
  const waiting = (id: string): boolean => { const e = held(id) ?? (host.pending()?.id === id ? host.pending() : null); return !!e && isIncomplete(e) }

  /** answers-45a (review-45 Q5): the read filter of a community event. Outside the QR window a host gives it only to whom seesEvent lets see it
   *  (invited personally, or a member while the community's mode is members); someone I cannot name as a person sees no community event. */
  const QR_ONLY = { id: '' }
  async function giveTo(peer: P, id: string): Promise<boolean> {
    const ev = held(id)
    const st = host.state()
    if (!ev || !mayAnswer(st, id, shown, host.now())) return false
    const viaQr = shown?.id === id && host.now() - shown.at <= EVENT_SHOW_WINDOW_MS
    if (!viaQr && !seesEvent(st, ev, st.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined) ?? QR_ONLY)) return false
    await host.send(peer, { v: 1, t: 'event', link: host.link(ev), show: visibilityOf(ev) })
    if (ev.openSpace) await host.send(peer, osEnvelope(ev)).catch(() => undefined)
    return true
  }

  /** The schedule as an envelope; a host also says the event is an open space (receivers accept that only from a host). */
  const osEnvelope = (ev: TwEvent): EventEnvelope => {
    const st = host.state()
    return { v: 1, t: 'event', os: { id: ev.id, ...(isEventHost(ev, st.me.displayName, st.people) ? { open: true as const } : {}), acts: ev.openSpace?.acts ?? [], ...(ev.openSpace?.poll ? { poll: ev.openSpace.poll } : {}) } }
  }
  const pushOs = async (ev: TwEvent, except?: string): Promise<void> => {
    if (!ev.openSpace) return
    const env = osEnvelope(ev)
    for (const peer of host.recipients?.(ev) ?? []) if (peer.id !== except) await host.send(peer, env).catch(() => undefined)
  }

  /** A schedule from a connected person: a host may turn a held event into an open space; anyone adds to a held open space. A change goes on to the other people, never back. */
  async function onOpenSpace(peer: P, os: NonNullable<EventEnvelope['os']>): Promise<boolean> {
    const ev = held(os.id)
    if (!ev) return false
    const st = host.state()
    const who = st.people.find((p) => p.peerId === peer.id)
    let changed = false
    if (!ev.openSpace && os.open && who && isEventHost(ev, who.name, st.people)) { ev.openSpace = { acts: [] }; changed = true }
    if (mergeActivities(ev, os.acts)) changed = true
    if (os.poll !== undefined && mergePoll(ev, os.poll, !!who && isEventHost(ev, who.name, st.people))) changed = true   // wave 45 open-space-date-poll
    if (!changed) return false
    host.save()
    host.changed()
    await pushOs(ev, peer.id)
    return true
  }

  /* wave44c event-autosave: the conference link, revealed only after a yes */
  const confEnv = (ev: TwEvent): EventEnvelope => ({ v: 1, t: 'event', conf: { id: ev.id, links: ev.conference ?? [] } })
  const peerOf = (id: string): P | undefined => host.peers?.().find((p) => p.id === id)
  /** The host: a guest's answer. A yes gets the links (and a later change); a no takes them off the list. */
  async function onRsvp(peer: P, r: NonNullable<EventEnvelope['rsvp']>): Promise<boolean> {
    const ev = held(r.id)
    const st = host.state()
    if (!ev || !isEventHost(ev, st.me.displayName, st.people)) return false
    if (r.show) { const g = st.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined); if (g) { noteShow(g, r.id, r.show); host.save() } }   // wave46 iyg-reviewfix F1
    const rest = (ev.confTo ?? []).filter((id) => id !== peer.id)
    const to = r.yes && ev.conference?.length ? [...rest, peer.id] : rest
    if (to.length) ev.confTo = to; else delete ev.confTo
    host.save()
    if (!r.yes || !ev.conference?.length) return !r.yes
    await host.send(peer, confEnv(ev))
    return true
  }
  /** The guest: links only from a host the event names, and only while I attend. */
  function onConf(peer: P, c: NonNullable<EventEnvelope['conf']>): boolean {
    const ev = held(c.id)
    const st = host.state()
    const who = st.people.find((p) => p.peerId === peer.id)
    if (!ev || !ev.attended || !who || !namedHost(ev, who.name, st.people)) return false
    if (c.links.length) ev.conference = c.links; else delete ev.conference
    host.save()
    host.changed()
    return true
  }

  /** Wave 44c seen-through: an introduction counts only from a host of an event I attend; the person sits outside my rings via that host. */
  function onSeen(peer: P, seen: NonNullable<EventEnvelope['seen']>): boolean {
    const st = host.state()
    const who = st.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined && !p.via)
    if (seen.id === undefined) { // wave46 iyg-roster: a community roster name; the sender must hold that community tag on my device
      if (!who || !seen.tag || !seen.who || String(who.fields?.[seen.tag]) !== 'true') return false
      if (!addSeenThrough(st, { via: who.id, who: seen.who, shown: true, source: 'event', tag: seen.tag, now: host.now(), id: 'seen-' + randomId(10) })) return false
      host.save()
      host.changed()
      return true
    }
    const ev = held(seen.id)
    if (!ev || !ev.attended || !who || !isEventHost(ev, who.name, st.people)) return false
    if (!addSeenThrough(st, { via: who.id, who: seen.who, shown: seen.shown, source: 'event', event: ev.id, now: host.now(), id: 'seen-' + randomId(10) })) return false
    host.save()
    host.changed()
    return true
  }

  /* wave44c answers-44d: an accepted invitation. The inviter / a host marks the guest joined; a host of an intimate community's event introduces them to the others there (accepting such an invitation says so in the join sheet). */
  async function onJoined(peer: P, j: NonNullable<EventEnvelope['joined']>): Promise<boolean> {
    const st = host.state()
    const id = resolveEvent(st, j.id) // wave45 merge-events: a joined record for a merged event lands on the kept one; the joiner is told
    const ev = held(id)
    if (ev && id !== j.id) await merge.tell(peer, ev, j.id)
    const guest = st.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined)
    if (ev && guest && j.show) { noteShow(guest, id, j.show); host.save() }   // wave46 iyg-reviewfix F1
    if (!ev || !applyJoined(st as Pick<AppState, 'people' | 'events'>, peer.id, id)) return false
    host.save()
    host.changed()
    await rosterSync() // wave46 iyg-roster: the joiner gets the others, the others get the joiner (was: intimate community only, joiner only)
    return true
  }

  /* wave46 iyg-roster: tell each connected recipient the names it has not heard (event_roster.ts); on a join, an edit of showAll, a save, app start. One run at a time. */
  let rostering = false
  async function rosterSync(): Promise<void> {
    if (rostering) return
    rostering = true
    try {
      const st = host.state()
      const personOf = (id: string): Person | undefined => st.people.find((p) => p.peerId === id && p.deleted_at === undefined)
      const sendNames = async (key: string, names: string[], to: P[], envOf: (who: string) => EventEnvelope): Promise<void> => {
        for (const peer of to) {
          const due = rosterDue(st.rosterSent?.[key]?.[peer.id], names, personOf(peer.id)?.name ?? '').slice(0, ROSTER_CAP)
          if (!due.length) continue
          st.rosterSent = { ...st.rosterSent, [key]: { ...st.rosterSent?.[key], [peer.id]: [...(st.rosterSent?.[key]?.[peer.id] ?? []), ...due] } }   // marked first: a failed send is not retried in a storm
          host.save()
          for (const who of due) await host.send(peer, envOf(who)).catch(() => undefined)
        }
      }
      for (const ev of st.events ?? []) {
        const names = rosterNames(st, ev)
        if (names.length) await sendNames(ev.id, names, host.recipients?.(ev) ?? [], (who) => ({ v: 1, t: 'event', seen: { id: ev.id, shown: true, who } }))
      }
      for (const tag of rosterTags(st)) {
        const names = communityRosterNames(st, tag)
        if (names.length) await sendNames('tag:' + tag, names, host.members?.(tag) ?? [], (who) => ({ v: 1, t: 'event', seen: { tag, shown: true, who } }))
      }
    } finally { rostering = false }
  }

  /* wave45 events-refetch: a connected person asks for what I announced; the announce envelopes go again (their receiver skips events it holds). Only members of the community, at most once per REPLAY_GAP_MS. */
  const askedAt = new Map<string, number>()
  async function replay(peer: P): Promise<boolean> {
    const t = host.now()
    if (t - (askedAt.get(peer.id) ?? -Infinity) < REPLAY_GAP_MS) return false
    askedAt.set(peer.id, t)
    let any = false
    for (const ev of host.state().events ?? []) {
      const tag = communityOfEvent(ev)
      if (ev.announcedAt === undefined || ev.shareCommunity !== true || !tag || !mayAnnounce(host.state(), tag) || !host.members?.(tag).some((m) => m.id === peer.id)) continue   // review-45: mode invited replays nothing
      await host.send(peer, { v: 1, t: 'event', link: host.link(ev), show: visibilityOf(ev), announce: true })
      if (ev.openSpace) await host.send(peer, osEnvelope(ev))
      any = true
    }
    return any
  }

  return {
    rosterSync, // wave46 iyg-roster
    /** wave45 merge-events: start a merge (event_merge_flow.ts) or answer the other host's ask. */
    merge: { start: merge.start, answer: merge.answer },
    /** answers-44d: I accepted the invitation: the person whose link or code I took (`by`) and the hosts I am connected to are told, sealed. */
    async joined(ev: TwEvent, by?: { name: string; did?: string }): Promise<void> {
      const st = host.state()
      const ids = st.people.filter((p) => p.peerId && p.deleted_at === undefined && !p.via && ((by && ((by.did && p.did === by.did) || p.name.trim() === by.name.trim())) || namedHost(ev, p.name, st.people))).map((p) => p.peerId as string)
      for (const id of new Set(ids)) { const peer = peerOf(id); if (peer) await host.send(peer, { v: 1, t: 'event', joined: { id: ev.id, show: visibilityOf(ev) } }).catch(() => undefined) }
    },
    /** Wave 44c: my "I will attend" (or not) goes to the hosts of the event I am connected to. */
    async rsvp(ev: TwEvent): Promise<void> {
      const st = host.state()
      const ids = st.people.filter((p) => p.peerId && namedHost(ev, p.name, st.people)).map((p) => p.peerId as string)
      for (const id of new Set(ids)) { const peer = peerOf(id); if (peer) await host.send(peer, { v: 1, t: 'event', rsvp: { id: ev.id, yes: ev.attended, show: visibilityOf(ev) } }).catch(() => undefined) }
    },
    /** Wave 44c: the host changed the conference link: the guests who accepted get the new one. */
    async pushConference(ev: TwEvent): Promise<void> {
      for (const id of ev.confTo ?? []) { const peer = peerOf(id); if (peer) await host.send(peer, confEnv(ev)).catch(() => undefined) }
    },
    /** The event QR of this event is on screen now. */
    shown(id: string, at: number = host.now()): void { shown = { id, at } },
    /** Wave 44 steer-open-space: my change to the schedule (a proposal, a join) goes to the people at this event. */
    pushOpenSpace: (ev: TwEvent): Promise<void> => pushOs(ev),
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
        const tag = communityOfEvent(ev) ?? ''
        for (const peer of mayAnnounce(host.state(), tag) ? host.members?.(tag) ?? [] : []) {   // wave45: mode invited tells nobody
          void host.send(peer, { v: 1, t: 'event', link, show: visibilityOf(ev), announce: true }).then(() => (ev.openSpace ? host.send(peer, osEnvelope(ev)) : undefined)).catch(() => undefined)
        }
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
    /** Wave 44c seen-through: a host introduces a person to the people at this event; the name only with that person's yes. */
    /** review-44c: `skip` = the peer id of the person introduced (they are at the event too; nothing goes back to them). */
    async introduce(id: string, who: string, shown: boolean, skip?: string): Promise<void> {
      const ev = held(id)
      if (!ev) return
      const env: EventEnvelope = { v: 1, t: 'event', seen: { id, shown, ...(shown ? { who: who.trim().slice(0, 40) } : {}) } }
      for (const peer of host.recipients?.(ev) ?? []) if (peer.id !== skip) await host.send(peer, env).catch(() => undefined)
    },
    /** A sealed event envelope from a connected peer. */
    async onEnvelope(peer: P, env: EventEnvelope): Promise<EnvelopeOutcome> {
      if (env.sync) return (await replay(peer).catch(() => false)) ? 'answered' : 'ignored' // wave45 events-refetch
      if (env.seen) return onSeen(peer, env.seen) ? 'filled' : 'ignored' // wave44c seen-through
      if (env.merge) return (await merge.onEnvelope(peer, env.merge).catch(() => false)) ? 'filled' : 'ignored' // wave45 merge-events
      if (env.joined) return (await onJoined(peer, env.joined).catch(() => false)) ? 'filled' : 'ignored' // wave44c answers-44d
      if (env.os) return (await onOpenSpace(peer, env.os)) ? 'filled' : 'ignored'
      if (env.rsvp) return (await onRsvp(peer, env.rsvp).catch(() => false)) ? 'answered' : 'ignored'   // wave44c event-autosave
      if (env.conf) return onConf(peer, env.conf) ? 'filled' : 'ignored'
      if (env.want !== undefined) return (await giveTo(peer, env.want).catch(() => false)) ? 'answered' : 'ignored'
      const linked = env.link === undefined ? null : decodeEventLink(env.link.slice(Math.max(0, env.link.indexOf('#'))))
      if (!linked) return 'ignored'
      const who = host.state().people.find((p) => p.peerId === peer.id)
      if (who && env.show) { noteShow(who, linked.id, env.show); host.save() }   // wave 44: how they show at this event
      if (env.announce && host.state().eventAlerts === false) return 'ignored'   // wave 44: the receiver turned the community alert off
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
