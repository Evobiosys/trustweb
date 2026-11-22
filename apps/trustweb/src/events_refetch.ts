// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 events-refetch (A03: "No events here" until the host's device synced again). Opening Events, a pull-down or Refresh asks every connected
 * person's device for the events they announced to a community I belong to ({t:'event', sync:true}, event_envelope.ts answers with the usual announce
 * envelopes, so nothing new is stored: receiveAnnounce skips known events). Like the feed's sources (feed_ext_sources.ts) it asks at most once per
 * EVENTS_TTL_MS; a manual refresh always asks.
 */
import type { EventEnvelope } from '../../demo/src/types'

export const EVENTS_TTL_MS = 5 * 60_000
/** A host answers the same person at most this often (a flood guard; the person's own cache is longer). */
export const REPLAY_GAP_MS = 60_000

export const refetchDue = (lastAt: number | undefined, now: number, explicit: boolean): boolean => explicit || lastAt === undefined || now - lastAt > EVENTS_TTL_MS

export interface EventsRefetchHost<P extends { id: string }> { now(): number; peers(): P[]; send(peer: P, env: EventEnvelope): Promise<void> }

/** `run` resolves with how many people were asked, or null while the cache is fresh; a person who cannot be reached is skipped. */
export function createEventsRefetch<P extends { id: string }>(h: EventsRefetchHost<P>): { run(explicit: boolean): Promise<number | null> } {
  let lastAt: number | undefined
  return {
    async run(explicit) {
      if (!refetchDue(lastAt, h.now(), explicit)) return null
      lastAt = h.now()
      const peers = h.peers()
      await Promise.all(peers.map((p) => h.send(p, { v: 1, t: 'event', sync: true }).catch(() => undefined)))
      return peers.length
    },
  }
}

/** How far a drag from the top of the list must go to count as a pull-down. */
export const PULL_PX = 70

/** Calls `fn` when a touch drag starts with the list at its top and ends PULL_PX or more lower. */
export function onPullDown(scroller: Pick<HTMLElement, 'scrollTop' | 'addEventListener'>, fn: () => void): void {
  let from: number | null = null
  scroller.addEventListener('touchstart', (e) => { from = scroller.scrollTop === 0 ? e.touches[0].clientY : null }, { passive: true })
  scroller.addEventListener('touchend', (e) => { if (from !== null && e.changedTouches[0].clientY - from >= PULL_PX) fn(); from = null }, { passive: true })
}
