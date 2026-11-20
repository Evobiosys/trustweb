// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 open-space-date-poll: the host of an online open space may add a date poll: several proposed dates (from, optional end on the same day),
 * each person answers yes / maybe / no per date (stored by token, open_space.ts tokenOf; the later answer wins a merge), and "Use this date" sets the
 * event's own from..to. Without a poll the host simply picks the date (the default). Pure, no DOM, so the MCP server loads it under plain node.
 * Dates and the choice are accepted from a host only; votes come from anyone.
 */
import type { DatePoll, DatePollOption, PollVote, TwEvent } from './model.ts'

export const POLL_MAX = 12
const DATE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/
const SAFE = /^[\w-]{1,24}$/
const VOTES: readonly string[] = ['yes', 'maybe', 'no']
const VOTERS_MAX = 200

const validDate = (s: string): boolean => DATE.test(s) && new Date(`${s}:00Z`).getTime() > 0 && new Date(`${s}:00Z`).toISOString().slice(0, 16) === s
const validEnd = (from: string, to: string): boolean => validDate(to) && to.slice(0, 10) === from.slice(0, 10) && to > from

/** A date as the option it makes, or null when it breaks a rule (the same rules for my date and for one that arrives). */
function clean(raw: unknown): DatePollOption | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !SAFE.test(r.id) || typeof r.from !== 'string' || !validDate(r.from)) return null
  if (r.to !== undefined && (typeof r.to !== 'string' || !validEnd(r.from, r.to))) return null
  const votes: DatePollOption['votes'] = {}
  if (typeof r.votes === 'object' && r.votes !== null) {
    for (const [t, x] of Object.entries(r.votes).slice(0, VOTERS_MAX)) {
      const v = x as { v?: unknown; at?: unknown } | null
      if (SAFE.test(t) && v && typeof v.v === 'string' && VOTES.includes(v.v) && typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0) votes[t] = { v: v.v as PollVote, at: v.at }
    }
  }
  return { id: r.id, from: r.from, ...(r.to ? { to: r.to as string } : {}), votes }
}

function pollOf(ev: TwEvent): DatePoll {
  if (!ev.openSpace) throw new Error('this event is no open space')
  if (!ev.openSpace.poll) throw new Error('this event has no date poll')
  return ev.openSpace.poll
}
const optionOf = (ev: TwEvent, id: string): DatePollOption => {
  const o = pollOf(ev).options.find((x) => x.id === id)
  if (!o) throw new Error(`no date "${id}" in this poll`)
  return o
}

/** The host adds a date; the first one starts the poll. Throws a plain message on a bad date, a duplicate, a full poll or a poll that has its winner. */
export function addPollOption(ev: TwEvent, p: { from: string; to?: string }, id: string): DatePollOption {
  if (!ev.openSpace) throw new Error('this event is no open space')
  const poll = ev.openSpace.poll ?? { options: [] }
  if (poll.chosen) throw new Error('a date is chosen already')
  if (!validDate(p.from)) throw new Error('the date must be YYYY-MM-DDTHH:MM')
  if (p.to && !validEnd(p.from, p.to)) throw new Error('the end must lie on the same day, after the start')
  if (poll.options.length >= POLL_MAX) throw new Error(`the poll holds at most ${POLL_MAX} dates`)
  if (poll.options.some((o) => o.from === p.from && o.to === (p.to || undefined))) throw new Error('this date is already in the poll')
  const o = clean({ id, from: p.from, ...(p.to ? { to: p.to } : {}), votes: {} })
  if (!o) throw new Error('the date is not valid')
  poll.options.push(o)
  ev.openSpace.poll = poll
  return o
}

/** My answer to one date: true when it changed anything. */
export function votePoll(ev: TwEvent, id: string, token: string, vote: string, now: number): boolean {
  if (!VOTES.includes(vote)) throw new Error('vote yes, maybe or no')
  const o = optionOf(ev, id)
  if (o.votes[token]?.v === vote) return false
  o.votes[token] = { v: vote as PollVote, at: now }
  return true
}

export function tallyOf(o: Pick<DatePollOption, 'votes'>): { yes: number; maybe: number; no: number } {
  const t = { yes: 0, maybe: 0, no: 0 }
  for (const { v } of Object.values(o.votes)) t[v]++
  return t
}

/** The date with the most yes, then the most yes plus maybe, then the earliest; null while nobody said yes. */
export function leadingOption(poll: DatePoll | undefined): DatePollOption | null {
  const best = [...(poll?.options ?? [])].filter((o) => tallyOf(o).yes > 0).sort((a, b) => {
    const x = tallyOf(a), y = tallyOf(b)
    return y.yes - x.yes || (y.yes + y.maybe) - (x.yes + x.maybe) || a.from.localeCompare(b.from)
  })
  return best[0] ?? null
}

/** The host's "Use this date": the event's own from..to become this date, the poll is closed. */
export function useDate(ev: TwEvent, id: string): void {
  const o = optionOf(ev, id)
  ev.from = o.from
  if (o.to) ev.to = o.to; else delete ev.to
  pollOf(ev).chosen = id
}

/** What another device sent: votes unite (the later answer wins); dates and the choice are taken only when `fromHost`. True when anything changed. */
export function mergePoll(ev: TwEvent, incoming: unknown, fromHost: boolean): boolean {
  if (!ev.openSpace || typeof incoming !== 'object' || incoming === null) return false
  const inc = incoming as { options?: unknown; chosen?: unknown }
  if (!Array.isArray(inc.options)) return false
  if (!ev.openSpace.poll && !fromHost) return false
  const poll = ev.openSpace.poll ?? { options: [] }
  let changed = false
  for (const raw of inc.options) {
    const o = clean(raw)
    if (!o) continue
    const mine = poll.options.find((x) => x.id === o.id)
    if (!mine) {
      if (!fromHost || poll.options.length >= POLL_MAX) continue
      poll.options.push(o); changed = true
      continue
    }
    for (const [t, x] of Object.entries(o.votes)) {
      if (x.at > (mine.votes[t]?.at ?? 0) && (mine.votes[t] || Object.keys(mine.votes).length < VOTERS_MAX)) { mine.votes[t] = x; changed = true }
    }
  }
  if (changed || ev.openSpace.poll) ev.openSpace.poll = poll
  if (fromHost && typeof inc.chosen === 'string' && !poll.chosen && poll.options.some((o) => o.id === inc.chosen)) { useDate(ev, inc.chosen); changed = true }
  return changed
}
