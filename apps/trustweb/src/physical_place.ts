// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation: a physical thing needs the place where it is (this phone only; sharing the thing never sends it by itself). */
import type { InventoryItem } from './model'

type Thing = Pick<InventoryItem, 'physical' | 'place'>

/** 'needs-place': a physical thing without a place (the app asks once: "Are you sure?"). */
export const placeCheck = (i: Thing): 'ok' | 'needs-place' => (i.physical === true && !(i.place ?? '').trim() ? 'needs-place' : 'ok')

/**
 * Marks a thing physical (or not) with its place. A physical thing without a place changes nothing and answers 'needs-place' unless the person
 * confirmed ("Continue"); `physical: false` clears both fields.
 */
export function setPhysical(i: Thing, physical: boolean, place: string, confirmedNoPlace: boolean): 'ok' | 'needs-place' {
  const where = place.trim()
  if (!physical) { delete i.physical; delete i.place; return 'ok' }
  if (!where && !confirmedNoPlace) return 'needs-place'
  i.physical = true
  if (where) i.place = where; else delete i.place
  return 'ok'
}
