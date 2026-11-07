// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 complete-view: "Export (3 files)": people.csv, timeline.csv, updates.csv in Dex's shape with snake_case headers. Local download only. Never the only-me note, the shared notes or timeline notes. Pure, DOM-free. */
import { cell, toCsv, type ExportOpts } from './contacts_export'
import { nextReminder } from './cadence'
import type { AppState, Person } from './model'
import { TlChannel } from './timeline'

export const EXPORT_FILES = ['people.csv', 'timeline.csv', 'updates.csv'] as const

export interface ExportCtx { s: Pick<AppState, 'events'>; opts: ExportOpts; groupsOf: (p: Person) => string[] }

const MULTI = ' ::: '
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const csv = (head: string[], rows: string[][]): string => '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'

/** The contacts file plus cadence_days, next_reminder and groups. */
export function peopleCsv(people: readonly Person[], c: ExportCtx): string {
  return toCsv(people, c.opts, {
    headers: ['cadence_days', 'next_reminder', 'groups'],
    values: (p) => {
      const next = nextReminder(p, c.opts.lastContact(p), c.opts.now)
      return [p.cadenceDays ? String(p.cadenceDays) : '', next === undefined ? '' : isoDay(next), c.groupsOf(p).join(MULTI)]
    },
  })
}

/** What happened with each person: the timeline entries typed or imported (notes left out) and the events they were at. */
export function timelineCsv(people: readonly Person[], c: ExportCtx): string {
  const rows = people.flatMap((p) => [
    ...(p.timeline ?? []).filter((e) => e.channel !== TlChannel.Note).map((e) => [p.name, new Date(e.at).toISOString(), e.channel, e.summary]),
    ...(p.events ?? []).flatMap((id) => (c.s.events ?? []).filter((ev) => ev.id === id).map((ev) => [p.name, ev.from, 'event', ev.name])),
  ])
  return csv(['person', 'date', 'kind', 'text'], rows)
}

/** TrustWeb keeps no history of ring changes, so this is a snapshot: each person's ring now, the ring before an archive, and the last contact. */
export function updatesCsv(people: readonly Person[], c: ExportCtx): string {
  return csv(['person', 'date', 'ring_before', 'ring_after'], people.map((p) => {
    const last = c.opts.lastContact(p)
    return [p.name, last === undefined ? '' : isoDay(last), p.prevRing ? c.opts.ringLabel(p.prevRing) : '', c.opts.ringLabel(p.ring)]
  }))
}
