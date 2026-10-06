/**
 * The shared meeting link that fills in later (wave 1733 round B, item 3;
 * Jakob: "the link at the end of a meeting might be empty while the
 * transcription is still being shared to there").
 *
 * Sender: a meeting sent (Meet code or "Send inside TrustWeb") while the Swiss
 * server is still transcribing it goes up marked `pending`, and its key is kept
 * WITH THE MEETING (amendment A3: the key alone derives the pack's slot and
 * write token, see backup.ts). When the transcript is done, the full pack is
 * PUT to the same slot under the same key (a fresh IV: backupNow), retried with
 * backoff, also on the next app open; then the key is dropped. A sender whose
 * transcription failed can send it as it is ("finalise"), so nobody waits forever.
 *
 * Receiver: a pending pack shows what is there and is checked again cheaply
 * (If-None-Match -> 304) while it is open; kept in past meetings, it remembers
 * the key and the version it has (`late`) and takes the full transcript when
 * it arrives (checked at app open and when the meeting is opened), for a week.
 *
 * DOM-free: the unit tests run these exact functions.
 */
import { ServerJobState } from './model'
import type { LateLink, OutboxPack, PastMeeting } from './model'
import type { MeetingPack } from './share'

/** At most this many early packs per meeting wait for the full version (each one a person it was sent to). */
export const OUTBOX_MAX = 20
/** The receiver's polling while a pending pack is open (contract: >= 15 s, back off to 60 s, stop after about 2 h). */
export const POLL_FIRST_MS = 15_000
export const POLL_MAX_MS = 60_000
export const POLL_GIVE_UP_MS = 2 * 60 * 60_000
/** A kept meeting looks for its full transcript this long, then stops looking. */
export const LATE_KEEP_MS = 7 * 24 * 60 * 60_000
/** The sender's retries for replacing one early pack (the PUT is idempotent: same slot, same token). */
export const SEND_BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 60_000]

/** Is the transcript of this stored meeting still on its way (the Swiss server is working on it)? */
export function transcriptStillComing(m: PastMeeting | undefined): boolean {
  return m?.serverJob?.state === ServerJobState.Running
}

/** The wait before the n-th check (0-based) of an open pending pack. */
export function pollDelay(attempt: number): number {
  return Math.min(POLL_MAX_MS, POLL_FIRST_MS * 2 ** Math.max(0, attempt))
}

/** Keeps an early pack's key with its meeting (once per key, capped). */
export function addToOutbox(m: PastMeeting, entry: OutboxPack): void {
  const rest = (m.outbox ?? []).filter((e) => e.keyText !== entry.keyText)
  m.outbox = [...rest, entry].slice(-OUTBOX_MAX)
}

/** The full version of an early pack: the same notes, the meeting's transcript as it is now. */
export function fullPackFor(m: PastMeeting, from: string, entry: OutboxPack, pending = false): MeetingPack {
  return {
    v: 1, kind: 'meeting', from, about: m.about, where: m.where, startedAt: m.startedAt, durationMs: m.durationMs,
    notes: entry.notes, transcript: m.transcript.map((t) => ({ speaker: t.speaker, atMs: t.atMs, text: t.text })),
    ...(pending ? { pending: true } : {}),
  }
}

export interface SendDeps {
  /** PUT the sealed pack under this key (backup.ts backupNow with the key parsed from the text). */
  upload: (keyText: string, pack: MeetingPack) => Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
  save: () => void
}

const flushing = new Set<string>()

/**
 * Replaces every early pack of `m` with its full version, each retried with
 * backoff; a pack that went out is dropped from the outbox (and its key with
 * it). Nothing is sent while the transcript is still coming, unless `finalise`
 * (the person chose to send it as it is). Returns how many went out.
 */
export async function flushOutbox(m: PastMeeting, from: string, deps: SendDeps, finalise = false): Promise<number> {
  if (!m.outbox?.length || flushing.has(m.id)) return 0
  if (transcriptStillComing(m) && !finalise) return 0
  flushing.add(m.id)
  let sent = 0
  try {
    for (const entry of [...m.outbox]) {
      if (await sendWithBackoff(entry.keyText, fullPackFor(m, from, entry), deps)) {
        m.outbox = (m.outbox ?? []).filter((e) => e.keyText !== entry.keyText)
        if (!m.outbox.length) delete m.outbox
        m.fullSentAt = deps.now()
        deps.save()
        sent++
      }
    }
  } finally {
    flushing.delete(m.id)
  }
  return sent
}

async function sendWithBackoff(keyText: string, pack: MeetingPack, deps: SendDeps): Promise<boolean> {
  for (let attempt = 0; attempt <= SEND_BACKOFF_MS.length; attempt++) {
    try {
      await deps.upload(keyText, pack)
      return true
    } catch {
      if (attempt === SEND_BACKOFF_MS.length) return false
      await deps.sleep(SEND_BACKOFF_MS[attempt])
    }
  }
  return false
}

/** Should a kept meeting still look for its full transcript? */
export function lateStillWanted(l: LateLink | undefined, now: number): boolean {
  return Boolean(l && typeof l.keyText === 'string' && now - l.since < LATE_KEEP_MS)
}

/**
 * A newer version of a kept pack arrived: take its transcript (the notes are
 * the same in every version and already on the sender's card). Complete: stop
 * looking; still pending: remember the version. Returns whether the meeting changed.
 */
export function applyLatePack(m: PastMeeting, pack: MeetingPack, etag: string | null): boolean {
  if (!m.late) return false
  m.transcript = pack.transcript.map((t) => ({ speaker: t.speaker, atMs: t.atMs, text: t.text }))
  if (pack.pending) m.late = { ...m.late, ...(etag ? { etag } : {}) }
  else delete m.late
  return true
}
