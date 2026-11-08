// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 people-fields: "I was in touch" without a tap. A message of a synced channel with a known person lifts their last-contact stamp (Person.engagementKept, the field the keep-in-touch cadence reads). Pure, DOM-free. */
import type { AppState, Person } from './model'
import { isDeleted } from './deleted_people'

export interface TouchEvent { personId: string; at: number }

const DAY_MS = 86_400_000

/** Raises engagementKept to the event time; true when it changed. Idempotent, never moves backwards (a manual tap of today stays), ignores the future, the day before we met, unknown and deleted people. */
export function touchFromSync(s: Pick<AppState, 'people'>, e: TouchEvent, now = Date.now()): boolean {
  const p: Person | undefined = s.people.find((x) => x.id === e.personId)
  if (!p || isDeleted(p) || e.at > now + DAY_MS || e.at < p.metAt) return false
  if (e.at <= (p.engagementKept ?? 0)) return false
  p.engagementKept = e.at
  return true
}
