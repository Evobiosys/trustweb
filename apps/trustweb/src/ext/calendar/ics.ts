// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Calendar .ics (wave 24, cal6): the RFC 5545 subset the calendar needs, written and read by hand, no DOM.
 * v1: timed events are floating local time (no TZID) on the way out; TZID times are read as local wall time. No RRULE on events, no attendees.
 * An .ics leaves the phone: it never holds invitees, people or tags of people (I1).
 */
import { newEvent, todayIso } from '../../events'
import type { AppState, TwEvent, TwTask } from '../../model'

const MAX_EVENTS = 2000
const MAX_BYTES = 2_000_000
const enc = new TextEncoder()

export interface IcsEvent { uid: string; name: string; from: string; to?: string; where: string; conditions?: string }

const esc = (v: string): string => v.replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n')
const unesc = (v: string): string => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Folds at 75 octets (continuation lines start with a space), never inside a character. */
function fold(line: string): string {
  const out: string[] = []
  let cur = '', bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += n
  }
  return [...out, cur].join('\r\n ')
}

const RRULE = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const
const compact = (v: string): string => v.replace(/[-:]/g, '')
const utc = (ms: number): string => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '')
const nextDay = (day: string): string => todayIso(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1, 12))
const prevDay = (day: string): string => todayIso(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) - 1, 12))
/** "2026-10-28" or "2026-10-28T14:00" as a DTSTART/DUE line (name carries the VALUE=DATE parameter for a day). */
const when = (name: string, v: string): string => (v.length === 10 ? `${name};VALUE=DATE:${compact(v)}` : `${name}:${compact(v)}00`)

function veventLines(e: TwEvent, stamp: string): string[] {
  const day = e.from.length === 10
  const end = day ? when('DTEND', nextDay((e.to ?? e.from).slice(0, 10))) : e.to ? when('DTEND', e.to.length === 10 ? `${nextDay(e.to)}T00:00` : e.to) : null
  return ['BEGIN:VEVENT', `UID:${e.id}@trustweb`, `DTSTAMP:${stamp}`, when('DTSTART', e.from), end, `SUMMARY:${esc(e.name)}`,
    e.where ? `LOCATION:${esc(e.where)}` : null, e.conditions ? `DESCRIPTION:${esc(e.conditions)}` : null, 'END:VEVENT'].filter((l): l is string => l !== null)
}

function vtodoLines(t: TwTask, stamp: string): string[] {
  return ['BEGIN:VTODO', `UID:${t.id}@trustweb`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(t.title)}`, when('DUE', t.due ?? ''),
    t.done ? 'STATUS:COMPLETED' : null, t.done ? `COMPLETED:${utc(t.done)}` : null, t.repeat ? `RRULE:FREQ=${RRULE[t.repeat]}` : null, 'END:VTODO']
    .filter((l): l is string => l !== null)
}

export function toIcs(events: TwEvent[], tasks: TwTask[], now: number, prodId = '-//TrustWeb//Calendar//EN'): string {
  const stamp = utc(now)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`, 'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => veventLines(e, stamp)), ...tasks.filter((t) => t.due).flatMap((t) => vtodoLines(t, stamp)), 'END:VCALENDAR']
  return lines.map(fold).join('\r\n') + '\r\n'
}

const DT = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/

/** ICS date or date-time as "YYYY-MM-DD[THH:MM]" local; Z times convert to local, anything else is taken as wall time. */
function localOf(value: string): { v: string; day: boolean } | null {
  const m = DT.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, , z] = m
  if (h === undefined) return { v: `${y}-${mo}-${d}`, day: true }
  if (!z) return { v: `${y}-${mo}-${d}T${h}:${mi}`, day: false }
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
  const p = (n: number): string => String(n).padStart(2, '0')
  return { v: `${todayIso(dt)}T${p(dt.getHours())}:${p(dt.getMinutes())}`, day: false }
}

export function fromIcs(text: string): { events: IcsEvent[]; skipped: number } {
  let skipped = 0
  if (text.length > MAX_BYTES) { text = text.slice(0, MAX_BYTES); skipped++ }
  const events: IcsEvent[] = []
  let cur: Record<string, string> | null = null
  let depth = 0 // components open inside the current top-level one
  let skipping = false
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const c = line.indexOf(':')
    if (c < 0) continue
    const [name] = line.slice(0, c).toUpperCase().split(';')
    const value = line.slice(c + 1)
    if (name === 'BEGIN') {
      if (value === 'VCALENDAR') continue
      if (cur || skipping) { depth++; continue }
      if (value === 'VEVENT') cur = {}
      else { skipping = true; if (value !== 'VTIMEZONE') skipped++ }
    } else if (name === 'END') {
      if (value === 'VCALENDAR') continue
      if (depth) { depth--; continue }
      if (skipping) { skipping = false; continue }
      const start = cur && localOf(cur.DTSTART ?? '')
      if (cur && start) {
        if (events.length >= MAX_EVENTS) skipped++
        else {
          const end = localOf(cur.DTEND ?? '')
          const to = end && (start.day ? (end.day ? prevDay(end.v) : end.v.slice(0, 10)) : end.v)
          events.push({ uid: cur.UID ?? '', name: unesc(cur.SUMMARY ?? '').trim(), from: start.v, ...(to && to !== start.v ? { to } : {}), where: unesc(cur.LOCATION ?? '').trim(), ...(cur.DESCRIPTION ? { conditions: unesc(cur.DESCRIPTION) } : {}) })
        }
      } else skipped++
      cur = null
    } else if (cur && !depth && !(name in cur)) {
      cur[name] = value
    }
  }
  return { events, skipped }
}

/** Adds the events; one whose uid I imported before, or exported as `<id>@trustweb`, is updated in place (invitees and local settings stay). */
export function importIcs(s: AppState, parsed: { events: IcsEvent[] }, newId: () => string, now: number): { added: number; updated: number } {
  let added = 0, updated = 0
  s.events ??= []
  for (const f of parsed.events) {
    const mine = f.uid ? s.events.find((e) => e.icsUid === f.uid || `${e.id}@trustweb` === f.uid) : undefined
    const fresh = newEvent(f, mine?.id ?? newId(), mine?.createdAt ?? now)
    if (typeof fresh === 'string') continue
    if (!mine) { s.events.push({ ...fresh, ...(f.uid ? { icsUid: f.uid } : {}) }); added++; continue }
    Object.assign(mine, { name: fresh.name, from: fresh.from, where: fresh.where })
    if (fresh.to) mine.to = fresh.to; else delete mine.to
    if (fresh.conditions) mine.conditions = fresh.conditions; else delete mine.conditions
    updated++
  }
  return { added, updated }
}
