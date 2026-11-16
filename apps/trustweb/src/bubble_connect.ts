// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect (Jakob 2026-11-16): holding one bubble on another in the Web view. A short hold (released between
 * INTRODUCE_MIN_MS and MERGE_HOLD_MS) INTRODUCES the two: each gets the other's connect code in a chat text, after a confirmation sheet.
 * A long hold (MERGE_HOLD_MS, the progress ring full) is the existing merge (dot_merge.ts). Pure and DOM-free; the sheet and the sending
 * live in bubble_connect_view.ts. I4/I8: nothing goes out without the owner's tap on the sheet; a person who wants to be asked first
 * (introducePermission 'ask-first') or is blocked is never introduced.
 */
import type { HoldState } from './dot_merge'
import type { Person } from './model'

// No runtime imports: apps/mcp loads this file under plain node (bubble_tools.ts). Links, texts and the ring are in bubble_links.ts.

/** Released after this long on the other bubble = an introduction (shorter: just a drop). */
export const INTRODUCE_MIN_MS = 300
/** Held this long = merge, as before; the progress ring is full. */
export const MERGE_HOLD_MS = 1500
/** Query parameter of an introduced connect link (bubble_links.ts). */
export const INTRO_PARAM = 'acq'

export const releaseOutcome = (h: HoldState, at: number): 'introduce' | 'none' =>
  h.phase === 'pending' && at - h.since >= INTRODUCE_MIN_MS && at - h.since < MERGE_HOLD_MS ? 'introduce' : 'none'

/** 0..1 for the progress ring on the target bubble. */
export const holdProgress = (h: HoldState, at: number): number => (h.phase === 'none' ? 0 : Math.min(1, Math.max(0, (at - h.since) / MERGE_HOLD_MS)))

export type IntroBlock = 'same' | 'not-connected' | 'blocked' | 'ask-first' | 'unknown'
export type Who = Pick<Person, 'id' | 'name' | 'peerId' | 'blocked' | 'introducePermission'>
export type PeerRef = { id: string; did: string; displayName: string }

/** Why two people cannot be introduced; null = they can. Both need a live connection (a peer with a DID) to be sent the other's code. */
export function introduceBlock(a: Who, b: Who, peers: readonly PeerRef[]): IntroBlock | null {
  if (a.id === b.id) return 'same'
  if ([a, b].some((p) => !p.peerId || !peers.some((x) => x.id === p.peerId && x.did))) return 'not-connected'
  if ([a, b].some((p) => (p.blocked ?? 0) > 0)) return 'blocked'
  if ([a, b].some((p) => p.introducePermission === 'ask-first')) return 'ask-first'
  return null
}

/** One introduction asked of an acceptor and not yet answered (the introducer's phone). requester = the person dragged, acceptor = the one dropped onto. */
export interface IntroPending { id: string; requester: string; acceptor: string; at: number }
/** One introduction asked of me (the acceptor's phone): who introduced (peer id), the requester's name and connect link. */
export interface IntroInbox { id: string; from: string; name: string; link: string; at: number }
export interface IntroQueued { requester: string; acceptor: string; at: number }

interface IntroRecord { people?: Who[]; peers?: PeerRef[]; introQueue?: IntroQueued[]; introPending?: IntroPending[]; introInbox?: IntroInbox[] }

/** MCP introduce_people: the tool has no chat channel, so it queues; the app sends when it next runs (takeIntroQueue). */
export function queueIntro(rec: IntroRecord, requesterId: string, acceptorId: string, now: number): { ok: true; already?: true } | { ok: false; reason: IntroBlock } {
  const a = rec.people?.find((p) => p.id === requesterId)
  const b = rec.people?.find((p) => p.id === acceptorId)
  if (!a || !b) return { ok: false, reason: 'unknown' }
  const block = introduceBlock(a, b, rec.peers ?? [])
  if (block) return { ok: false, reason: block }
  const q = rec.introQueue ?? []
  if (q.some((i) => i.requester === requesterId && i.acceptor === acceptorId)) return { ok: true, already: true }
  rec.introQueue = [...q, { requester: requesterId, acceptor: acceptorId, at: now }]
  return { ok: true }
}

export function takeIntroQueue(rec: IntroRecord): IntroQueued[] {
  const q = rec.introQueue ?? []
  delete rec.introQueue
  return q
}

/** Removes and returns the item with this id from rec[key]; undefined when there is none. */
export function takeById<K extends 'introPending' | 'introInbox'>(rec: IntroRecord, key: K, id: string): NonNullable<IntroRecord[K]>[number] | undefined {
  const list = (rec[key] ?? []) as { id: string }[]
  const hit = list.find((i) => i.id === id)
  if (!hit) return undefined
  const rest = list.filter((i) => i !== hit)
  if (rest.length) (rec as Record<string, unknown>)[key] = rest
  else delete rec[key]
  return hit as NonNullable<IntroRecord[K]>[number]
}

/** Adds an item once per id (a repeated request or send keeps the first). */
export function addOnce<K extends 'introPending' | 'introInbox'>(rec: IntroRecord, key: K, item: NonNullable<IntroRecord[K]>[number]): boolean {
  const list = (rec[key] ?? []) as { id: string }[]
  if (list.some((i) => i.id === item.id)) return false
  ;(rec as Record<string, unknown>)[key] = [...list, item].slice(-50)
  return true
}
