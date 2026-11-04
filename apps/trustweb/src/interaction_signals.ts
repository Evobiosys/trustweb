// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 wabridge-ingest: what a phone export says about one person beyond "who wrote to whom": how much, how recently, who starts the
 * talk, how fast they answer, how many groups we share. One closeness score (0..1) comes out; onboarding_place.ts turns it into a first-guess
 * ring. Pure: times and directions only, never text (I1).
 */
export interface Msg { ts: number; fromMe: boolean }

export interface Signals {
  messages: number
  lastTs?: number
  /** Share (0..1) of conversations I started; undefined without messages. */
  initiatedByMe?: number
  /** Median time they took to answer me inside one conversation; undefined when they never did. */
  medianReplyMs?: number
  /** Groups I share with them. */
  groups: number
}

/** Silence of this long ends a conversation: the next message starts a new one. */
const GAP_MS = 6 * 3_600_000
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** At or above: Close friends and allies is suggested. Below MIN_SCORE (talking both ways): not yet sorted. */
export const CLOSE_SCORE = 0.7
export const MIN_SCORE = 0.15

const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }

/** `chat`: the messages of the one-to-one chat with this person, any order. */
export function signalsFor(chat: readonly Msg[], groups: number): Signals {
  const list = [...chat].sort((a, b) => a.ts - b.ts)
  let starts = 0
  let mine = 0
  const replies: number[] = []
  list.forEach((m, i) => {
    const prev = list[i - 1]
    if (!prev || m.ts - prev.ts >= GAP_MS) { starts++; if (m.fromMe) mine++ } else if (prev.fromMe && !m.fromMe) replies.push(m.ts - prev.ts)
  })
  return {
    messages: list.length, groups,
    ...(list.length ? { lastTs: list[list.length - 1].ts, initiatedByMe: mine / starts } : {}),
    ...(replies.length ? { medianReplyMs: median(replies) } : {}),
  }
}

/** Weighted sum: volume 35 %, recency (half-life 60 days) 25 %, balance of who starts 15 %, reply speed (1 h = full, 24 h = none) 15 %, shared groups 10 % (5 = full). */
export function closeness(s: Signals, now: number): number {
  const volume = Math.min(1, Math.log1p(s.messages) / Math.log1p(300))
  const recency = s.lastTs === undefined ? 0 : 0.5 ** (Math.max(0, now - s.lastTs) / (60 * DAY))
  const balance = s.initiatedByMe === undefined ? 0 : 1 - Math.abs(2 * s.initiatedByMe - 1)
  const reply = s.medianReplyMs === undefined ? 0 : Math.min(1, Math.max(0, 1 - (s.medianReplyMs - HOUR) / (23 * HOUR)))
  const groups = Math.min(s.groups, 5) / 5
  return 0.35 * volume + 0.25 * recency + 0.15 * balance + 0.15 * reply + 0.1 * groups
}
