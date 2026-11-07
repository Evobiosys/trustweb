// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36: deleting a person is a tombstone for 30 days (`deleted_at`): the person leaves every view like an archived one, Settings > Recently deleted puts them back, `purgeDue` removes them for good afterwards. Pure, DOM-free. */
import { Ring } from './model'
import type { Person } from './model'

export const DELETE_DAYS = 30
const DAY_MS = 86_400_000

type Mark = Pick<Person, 'ring' | 'prevRing' | 'deleted_at'>

export const isDeleted = (p: Pick<Person, 'deleted_at'>): boolean => p.deleted_at !== undefined

/** Everyone who is not deleted: the list every display, count, search and sync bundle reads. */
export const alive = <P extends Pick<Person, 'deleted_at'>>(people: readonly P[]): P[] => people.filter((p) => !isDeleted(p))

/** Tombstones a person: filed under Ring.None (every view leaves them out) with the ring they had; angle and everything else stay. */
export function deletePersonSoft(p: Mark, nowMs: number): void {
  if (isDeleted(p)) return
  if (p.ring !== Ring.None) p.prevRing = p.ring
  p.ring = Ring.None
  p.deleted_at = new Date(nowMs).toISOString()
}

/** Back on the ring they had (Not yet sorted without a remembered one); deleted_at cleared. */
export function putBack(p: Mark): void {
  p.ring = p.prevRing && p.prevRing !== Ring.None ? p.prevRing : Ring.Unsorted
  delete p.prevRing
  delete p.deleted_at
}

/** Whole days left before the purge, 0 when due. */
export function daysLeft(p: Pick<Person, 'deleted_at'>, nowMs: number): number {
  if (!p.deleted_at) return DELETE_DAYS
  const left = DELETE_DAYS - Math.floor((nowMs - Date.parse(p.deleted_at)) / DAY_MS)
  return Math.min(DELETE_DAYS, Math.max(0, left))
}

/** Deleted people still inside their 30 days, newest deletion first. */
export const recentlyDeleted = <P extends Pick<Person, 'deleted_at'>>(people: readonly P[], nowMs: number): P[] =>
  people.filter((p) => isDeleted(p) && !purgeDueFor(p, nowMs)).sort((a, b) => Date.parse(b.deleted_at!) - Date.parse(a.deleted_at!))

const purgeDueFor = (p: Pick<Person, 'deleted_at'>, nowMs: number): boolean => p.deleted_at !== undefined && nowMs - Date.parse(p.deleted_at) > DELETE_DAYS * DAY_MS

/** Ids deleted more than 30 days ago (an unreadable stamp counts as due: it can never be undone anyway). */
export const purgeDue = (s: { people: readonly Pick<Person, 'id' | 'deleted_at'>[] }, nowMs: number): string[] =>
  s.people.filter((p) => p.deleted_at !== undefined && (Number.isNaN(Date.parse(p.deleted_at)) || purgeDueFor(p, nowMs))).map((p) => p.id)
