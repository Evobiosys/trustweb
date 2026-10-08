/**
 * Wave 6f, THE ONE THING: whoever opens my link must appear in MY web too, also when my phone was not online at that moment.
 *
 * The one-scan handshake is one-way: the phone that opens a link sends a cleartext connect-ack to the sharer (net.ts completeConnect);
 * the sharer answers with its name in a sealed "hello" (hello.ts). The relay already holds an undelivered wire for an offline phone
 * (store-and-forward, at most 72 hours, packages/transport relay_queue_store.ts), so a sharer who reopens the app later still gets the
 * ack. What was lost before this module: an ack whose relay POST failed (a train tunnel, a sleeping laptop's dead network) was never
 * sent again, and one held longer than the relay keeps it was gone.
 *
 * So the scanning phone keeps re-sending its ack until it HEARS from the sharer (any sealed envelope that opens with the pair key, the
 * hello first of all), with a growing gap, a cap on the number of sends and a horizon of a week. A re-sent ack is byte-for-byte the wire
 * the first one was (the same public DID and name), so nothing new travels in cleartext and nothing about the receiving side's
 * matching (net.ts upsertPeer) is widened. Each send is one row in the sharer's relay queue, which is why the gap and the cap exist.
 *
 * Pure and DOM-free.
 */
import type { Peer } from './model'

/** Re-send for at most this long after the connection was made. */
export const ACK_RETRY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
/** At most this many acks accepted by the relay per connection (the first one included). */
export const ACK_MAX_TRIES = 8
/** The gap after the first accepted send; it doubles with every further one, up to ACK_GAP_MAX_MS. */
export const ACK_GAP_BASE_MS = 15 * 60 * 1000
export const ACK_GAP_MAX_MS = 12 * 60 * 60 * 1000

/** How long to wait after the `tries`-th accepted send before the next one. */
export function ackGapMs(tries: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(tries) ? tries : 1))
  return Math.min(ACK_GAP_BASE_MS * 2 ** Math.min(n - 1, 16), ACK_GAP_MAX_MS)
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Should this phone send its connect-ack to `peer` (again) now? Never once it heard from them, never past the horizon or the cap;
 * a connection whose ack was never accepted (no ackSentAt, e.g. an older record or a failed first POST) is due at once.
 * A malformed record answers false (nothing is sent on a guess).
 */
export function ackDue(peer: Pick<Peer, 'heardAt' | 'ackTries' | 'ackSentAt' | 'connectedAt'>, now: number): boolean {
  if (peer.heardAt !== undefined) return false
  if (!isTime(peer.connectedAt) || now - peer.connectedAt > ACK_RETRY_HORIZON_MS) return false
  const tries = isTime(peer.ackTries) ? peer.ackTries : 0
  if (tries >= ACK_MAX_TRIES) return false
  if (!isTime(peer.ackSentAt)) return true
  return now - peer.ackSentAt >= ackGapMs(tries)
}

/**
 * Within one visit, whatever the outcome of a send: at least this long between two attempts for one connection, and at most
 * ACK_ATTEMPTS_PER_VISIT of them. A send that failed is not counted in the record (ackTries), yet one that timed out on this side may
 * still have been stored by the relay, and every reconnect of the drain (a wake after a long sleep opens a fresh socket) asks again:
 * without this an unlucky network would add a row to the sharer's queue at every reconnect.
 */
export const ACK_ATTEMPT_GAP_MS = 2 * 60 * 1000
export const ACK_ATTEMPTS_PER_VISIT = ACK_MAX_TRIES

/** This visit's attempts for one connection (memory only, never stored). */
export interface AckAttempts {
  at: number
  n: number
}

/** May this visit try once more for that connection? */
export function attemptAllowed(last: AckAttempts | undefined, now: number): boolean {
  if (!last) return true
  return last.n < ACK_ATTEMPTS_PER_VISIT && now - last.at >= ACK_ATTEMPT_GAP_MS
}

/** One more attempt this visit. */
export function nextAttempts(last: AckAttempts | undefined, now: number): AckAttempts {
  return { at: now, n: (last?.n ?? 0) + 1 }
}

/** Records one ack the relay accepted. */
export function noteAckSent(peer: Peer, now: number): void {
  peer.ackTries = (isTime(peer.ackTries) ? peer.ackTries : 0) + 1
  peer.ackSentAt = now
}

/** Records that this phone heard from them (once; later envelopes change nothing). True when it changed the record. */
export function noteHeard(peer: Peer, now: number): boolean {
  if (peer.heardAt !== undefined) return false
  peer.heardAt = now
  return true
}
