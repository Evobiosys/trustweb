// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: reminders that came due while the page was open wait here and show in the Events panel (not as a global notice). Memory only. */
export interface Reminder {
  title: string
  openLabel: string
  onOpen: () => void
}

const waiting: Reminder[] = []

export const remindersWaiting = (): readonly Reminder[] => waiting

export function addReminder(r: Reminder): void {
  if (!waiting.some((w) => w.title === r.title)) waiting.push(r)
}

export function dismissReminder(r: Reminder): void {
  const i = waiting.indexOf(r)
  if (i >= 0) waiting.splice(i, 1)
}
