// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 offline-outbox (Jakob 2026-11-19): everything this phone sends to a connected person (chat texts that carry invites, shares and
 * asks' follow-ups, hosting messages, event envelopes) goes through ONE outbox when the relay does not take it at once. The sealed-to-be
 * envelope waits in AppState.sendQueue (saved with the record, so a reload loses nothing), is sent when the relay is back, and is retried
 * with a growing gap (as ack_retry.ts does for the connect-ack). Settings > Pending lists it with a status per item; MCP: outbox_list.
 * Pure, no imports (apps/mcp loads it under plain node).
 */
export type OutboxKind = 'text' | 'host' | 'event'
export type OutboxState = 'waiting' | 'sent' | 'failed'
export interface OutboxItem { id: string; peerId: string; kind: OutboxKind; env: unknown; queuedAt: number; tries: number; nextAt: number; state: OutboxState; sentAt?: number }
type Rec = { sendQueue?: OutboxItem[] } & object

/** The gap after the first failed send; it doubles with every further one up to OUTBOX_MAX_MS. */
export const OUTBOX_BASE_MS = 30 * 1000
export const OUTBOX_MAX_MS = 60 * 60 * 1000
/** A waiting item that could not be sent for this long turns `failed` (still listed, never dropped). */
export const OUTBOX_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
/** Sent items are kept this long for the status line, and at most this many items are held; waiting ones are never dropped to make room. */
export const OUTBOX_SENT_KEEP_MS = 24 * 60 * 60 * 1000
export const OUTBOX_MAX_ITEMS = 200

export function backoffMs(tries: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(tries) ? tries : 1))
  return Math.min(OUTBOX_BASE_MS * 2 ** Math.min(n - 1, 16), OUTBOX_MAX_MS)
}

const queueOf = (s: Rec): OutboxItem[] => (Array.isArray(s.sendQueue) ? s.sendQueue : [])

/** Drops sent items past their keep time, then the oldest sent/failed ones beyond the bound. */
function prune(list: OutboxItem[], now: number): OutboxItem[] {
  let out = list.filter((x) => !(x.state === 'sent' && now - (x.sentAt ?? x.queuedAt) > OUTBOX_SENT_KEEP_MS))
  for (const x of [...out]) {
    if (out.length <= OUTBOX_MAX_ITEMS) break
    if (x.state !== 'waiting') out = out.filter((y) => y !== x)
  }
  return out
}

/** Queues one envelope for `peerId`; due at once. */
export function enqueue(s: Rec, i: Pick<OutboxItem, 'peerId' | 'kind' | 'env'>, now: number): OutboxItem {
  const item: OutboxItem = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, peerId: i.peerId, kind: i.kind, env: i.env, queuedAt: now, tries: 0, nextAt: now, state: 'waiting' }
  s.sendQueue = prune([...queueOf(s), item], now)
  return item
}

/** Waiting items whose gap has passed, oldest first. */
export const dueItems = (s: Rec, now: number): OutboxItem[] => queueOf(s).filter((x) => x.state === 'waiting' && x.nextAt <= now)

export function markSent(s: Rec, id: string, now: number): void {
  const x = queueOf(s).find((y) => y.id === id)
  if (x) { x.state = 'sent'; x.sentAt = now }
}

/** One more failed try: wait the backoff, or turn `failed` once past the horizon. */
export function markFailed(s: Rec, id: string, now: number): void {
  const x = queueOf(s).find((y) => y.id === id)
  if (!x) return
  x.tries += 1
  if (now - x.queuedAt > OUTBOX_HORIZON_MS) x.state = 'failed'
  else x.nextAt = now + backoffMs(x.tries)
}

/** What Settings > Pending shows: waiting and failed always, sent for a day; newest first. */
export const shownItems = (s: Rec, now: number): OutboxItem[] => prune(queueOf(s), now).sort((a, b) => b.queuedAt - a.queuedAt)

/** When the next waiting item is due (undefined: nothing waits). */
export function nextDueAt(s: Rec): number | undefined {
  const t = queueOf(s).filter((x) => x.state === 'waiting').map((x) => x.nextAt)
  return t.length ? Math.min(...t) : undefined
}
