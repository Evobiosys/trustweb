// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 complete-view: keep in touch every N days (Person.cadenceDays; absent = off). The keep-in-touch reminders build on these names. Pure, DOM-free. */
import type { Person } from './model'

const DAY_MS = 86_400_000

/** The cadences the complete view's select offers, in days. */
export const CADENCE_CHOICES: readonly number[] = [7, 14, 30, 90, 180, 365]

/** The day the next contact is due: N days after the last contact (else the day we met, else now); undefined while the cadence is off. */
export function nextReminder(p: Pick<Person, 'cadenceDays' | 'metAt'>, last: number | undefined, now: number): number | undefined {
  if (!p.cadenceDays) return undefined
  return (last || p.metAt || now) + p.cadenceDays * DAY_MS
}

export function isOverdue(p: Pick<Person, 'cadenceDays' | 'metAt'>, last: number | undefined, now: number): boolean {
  const next = nextReminder(p, last, now)
  return next !== undefined && next <= now
}
