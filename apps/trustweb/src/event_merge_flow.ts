// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events: the sealed steps between devices (EventEnvelope.merge, apps/demo/src/wire.ts parseMerge). No server holds anything.
 *   - A host of both events merges at once (event_merge.ts) and sends `done` (with the kept event as a link) to the gone event's people.
 *   - A host of only the kept event sends `ask` to the connected hosts of the other one; it waits as an `out` ask. The other host sees an `in`
 *     ask (notification row + card on the event page) and answers: `yes` merges on their device, tells their people (`done`) and the asker,
 *     whose device merges too; `no` ends the ask.
 *   - A `joined` record for a merged id lands on the kept event (event_envelope.ts onJoined) and the joiner is sent `done` (tell).
 * Nobody else is heard: an ask only from a host the kept event's link names, to a host of the gone event; `done` only from a host the gone
 * event names; `yes` / `no` only for an ask I sent to that peer.
 */
import type { EventEnvelope } from '../../demo/src/types'
import type { AppState, TwEvent } from './model'
import { decodeEventLink } from './event_link'
import { mayApprove } from './event_roles'
import { namedHost } from './event_conference'
import { addItem } from './notify_inbox'
import { mayMerge, mergeEvents, type MergeAsk } from './event_merge'
import { S } from './strings'

export interface MergeHost<P extends { id: string }> {
  state(): Pick<AppState, 'events' | 'me' | 'people'> & Partial<AppState>
  save(): void
  now(): number
  changed(): void
  link(ev: TwEvent): string
  send(peer: P, env: EventEnvelope): Promise<void>
  peers?(): P[]
  recipients?(ev: TwEvent): P[]
}
/** merged: done here; asked: waiting for the other host; no-host: no host of the other event is connected; no: not mine to merge. */
export type MergeStart = 'merged' | 'asked' | 'no-host' | 'no'
type Step = NonNullable<EventEnvelope['merge']>

/** The connected, live people the event names as host (or organizer): who can say yes to a merge. */
export function hostPeersOf(s: Pick<AppState, 'people'>, ev: TwEvent): AppState['people'] {
  return s.people.filter((p) => p.peerId && p.deleted_at === undefined && !p.via && namedHost(ev, p.name, s.people))
}

export function createEventMerge<P extends { id: string }>(host: MergeHost<P>) {
  const st = (): AppState => host.state() as AppState
  const held = (id: string): TwEvent | undefined => st().events?.find((e) => e.id === id)
  const peerOf = (id: string | undefined): P | undefined => host.peers?.().find((p) => p.id === id)
  const env = (merge: Step): EventEnvelope => ({ v: 1, t: 'event', merge })
  const setAsks = (asks: MergeAsk[]): void => { const s = st(); if (asks.length) s.eventMergeAsks = asks; else delete s.eventMergeAsks }
  const dropAsk = (m: Pick<MergeAsk, 'dir' | 'keep' | 'gone'>): void => setAsks((st().eventMergeAsks ?? []).filter((a) => !(a.dir === m.dir && a.keep === m.keep && a.gone === m.gone)))
  const linked = (link: string | undefined, id: string): TwEvent | null => {
    const l = link ? decodeEventLink(link.slice(Math.max(0, link.indexOf('#')))) : null
    if (!l || l.id !== id) return null
    const { kind: _kind, by: _by, ...ev } = l
    return { ...ev, createdAt: host.now(), attended: false, fromLink: true }
  }

  /** Merges here (the kept event added from its link first when this device lacks it); the gone event's people are told. */
  async function mergeHere(keep: TwEvent, goneId: string, skip?: string): Promise<number> {
    const gone = held(goneId)
    const people = gone ? (host.recipients?.(gone) ?? []).filter((p) => p.id !== skip) : []
    if (!held(keep.id)) { keep.attended = gone?.attended ?? false; st().events = [...(st().events ?? []), keep] }
    const r = mergeEvents(st(), keep.id, goneId, host.now())
    host.save()
    host.changed()
    const link = host.link(held(keep.id) as TwEvent)
    for (const p of people) await host.send(p, env({ step: 'done', keep: keep.id, gone: goneId, link })).catch(() => undefined)
    return r?.people ?? 0
  }

  /** The asker: the other host said yes (merge here) or no (the ask ends). */
  async function onAnswer(peer: P, m: Step): Promise<boolean> {
    const ask = (st().eventMergeAsks ?? []).find((a) => a.dir === 'out' && a.keep === m.keep && a.gone === m.gone && a.peer === peer.id)
    const keep = held(m.keep)
    if (!ask || !keep) return false
    dropAsk(ask)
    if (m.step === 'no') { host.save(); host.changed(); return true }
    if (held(m.gone)) await mergeHere(keep, m.gone, peer.id)
    else { st().eventMerged = { ...st().eventMerged, [m.gone]: m.keep }; host.save(); host.changed() }
    return true
  }

  /** The other host: an ask from a host of the kept event about an event I host. */
  function onAsk(peer: P, m: Step): boolean {
    const s = st()
    const who = s.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined && !p.via)
    const keep = linked(m.link, m.keep)
    const gone = held(m.gone)
    if (!who || !keep || !gone || held(m.keep) === gone || !namedHost(keep, who.name, s.people) || !mayApprove(gone, s.me.displayName, s.people)) return false
    const ask: MergeAsk = { dir: 'in', keep: m.keep, gone: m.gone, peer: peer.id, from: who.name, at: host.now(), link: m.link }
    setAsks([...(s.eventMergeAsks ?? []).filter((a) => !(a.dir === 'in' && a.keep === m.keep && a.gone === m.gone)), ask])
    s.notifInbox = addItem(s.notifInbox ?? [], { id: `merge:${m.keep}:${m.gone}`, kind: 'event', title: S.w45merge.askTitle(who.name, keep.name), body: S.w45merge.askBody, at: host.now(), seenAt: null, eventId: m.gone })
    host.save()
    host.changed()
    return true
  }

  /** A person at the gone event: its host says it is merged into the kept one. */
  async function onDone(peer: P, m: Step): Promise<boolean> {
    const s = st()
    const who = s.people.find((p) => p.peerId === peer.id && p.deleted_at === undefined && !p.via)
    const gone = held(m.gone)
    const keep = held(m.keep) ?? linked(m.link, m.keep)
    if (!who || !gone || !keep || !namedHost(gone, who.name, s.people)) return false
    await mergeHere(keep, m.gone)
    return true
  }

  return {
    /** Merge `gone` into `keep`: at once when I host both, else ask the other event's connected hosts. */
    async start(keepId: string, goneId: string): Promise<MergeStart> {
      const may = mayMerge(st(), keepId, goneId)
      if (may === 'no') return 'no'
      const keep = held(keepId) as TwEvent
      if (may === 'now') { await mergeHere(keep, goneId); return 'merged' }
      const hosts = hostPeersOf(st(), held(goneId) as TwEvent).flatMap((p) => { const peer = peerOf(p.peerId); return peer ? [{ peer, name: p.name }] : [] })
      if (!hosts.length) return 'no-host'
      const link = host.link(keep)
      const asks = hosts.map(({ peer, name }): MergeAsk => ({ dir: 'out', keep: keepId, gone: goneId, peer: peer.id, from: name, at: host.now() }))
      setAsks([...(st().eventMergeAsks ?? []).filter((a) => !(a.dir === 'out' && a.keep === keepId && a.gone === goneId)), ...asks])
      host.save()
      for (const { peer } of hosts) await host.send(peer, env({ step: 'ask', keep: keepId, gone: goneId, link })).catch(() => undefined)
      return 'asked'
    },
    /** My answer to another host's ask; false when there is no such ask (or its asker is no longer connected). */
    async answer(keepId: string, goneId: string, yes: boolean): Promise<boolean> {
      const ask = (st().eventMergeAsks ?? []).find((a) => a.dir === 'in' && a.keep === keepId && a.gone === goneId)
      const peer = peerOf(ask?.peer)
      const keep = held(keepId) ?? linked(ask?.link, keepId)
      if (!ask || !peer || !keep) return false
      dropAsk(ask)
      host.save()
      await host.send(peer, env({ step: yes ? 'yes' : 'no', keep: keepId, gone: goneId })).catch(() => undefined)
      if (yes && held(goneId)) await mergeHere(keep, goneId, peer.id)
      else host.changed()
      return true
    },
    /** A joined record named the merged id: the joiner's device hears the event is merged (sent by me, a host of it). */
    async tell(peer: P, keep: TwEvent, goneId: string): Promise<void> {
      await host.send(peer, env({ step: 'done', keep: keep.id, gone: goneId, link: host.link(keep) })).catch(() => undefined)
    },
    async onEnvelope(peer: P, m: Step): Promise<boolean> {
      if (m.step === 'ask') return onAsk(peer, m)
      if (m.step === 'done') return onDone(peer, m)
      return onAnswer(peer, m)
    },
  }
}
