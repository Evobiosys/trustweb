// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Trust Hub onboarding from a WhatsApp export (wave 30): when to offer it, the first-guess ring of every imported person (steering D1) and
 * the one tap that writes them. Pure: no DOM, no network, no storage. The ring is a first guess the owner can change on the Curate page;
 * frequency only ever raises a suggestion, never a placement above Acquaintances (I9).
 */
import { Ring } from './model'
import type { AppState, ServiceRow } from './model'
import { decide, pendingProposals } from './services_import'
import { S } from './strings'

type State = Pick<AppState, 'people' | 'serviceImports'>

/** Both ways on this many distinct days in the last year: a Close friends and allies suggestion. */
export const CLOSE_DAYS = 100

export interface Placement { ring: Ring; /** Shown with the person; never written as a ring. */ suggested?: Ring; note?: string }

/** The empty-web card: nobody in the record and not dismissed this session. */
export const showOnboarding = (s: Pick<AppState, 'people'>, dismissed: boolean): boolean => !dismissed && s.people.length === 0

export function placementFor(r: Pick<ServiceRow, 'n365' | 'out' | 'in' | 'days' | 'group'>): Placement {
  if (r.group !== undefined) return { ring: Ring.Unsorted, note: S.onbSeenInGroup(r.group) }
  if (r.n365 > 0 && r.out > 0 && r.in > 0) return { ring: Ring.Acquaintance, ...((r.days ?? 0) >= CLOSE_DAYS ? { suggested: Ring.Close } : {}) }
  if (r.n365 > 0 && r.out > 0) return { ring: Ring.Intending }
  return { ring: Ring.Unsorted }
}

export interface Result { total: number; both: number; wroteOnly: number; groupOnly: number }

export function resultOf(rows: readonly ServiceRow[]): Result {
  const r: Result = { total: rows.length, both: 0, wroteOnly: 0, groupOnly: 0 }
  for (const x of rows) {
    if (x.group !== undefined) r.groupOnly++
    else if (x.out > 0 && x.in > 0) r.both++
    else if (x.out > 0) r.wroteOnly++
  }
  return r
}

/** Writes every pending row at its placement; returns how many people are new and how many carry a Close suggestion. */
export function placeAll(s: State, now: number, newId: () => string): { placed: number; close: number } {
  const out = { placed: 0, close: 0 }
  for (const { batchId, row } of pendingProposals(s, now)) {
    const pl = placementFor(row)
    // A name already in the web keeps its ring: only the source stamp is added.
    decide(s, batchId, row.key, row.dupe ? { do: 'accept' } : { do: 'change', ring: pl.ring }, now, newId)
    const done = s.serviceImports?.find((b) => b.id === batchId)?.done[row.key]
    const person = done?.created ? s.people.find((p) => p.id === done.personId) : undefined
    if (!person) continue
    out.placed++
    const notes = [pl.note, pl.suggested ? S.onbSuggested(S.ringLabel[pl.suggested]) : undefined].filter(Boolean)
    if (notes.length) person.context = [person.context, ...notes].join(' · ')
    if (pl.suggested) out.close++
  }
  return out
}

export type Platform = 'android' | 'iphone' | 'desktop'
export const exportSteps = (userAgent: string): Platform => /android/i.test(userAgent) ? 'android' : /iphone|ipad|ipod/i.test(userAgent) ? 'iphone' : 'desktop'

export const isZip = (name: string): boolean => /\.zip$/i.test(name)
