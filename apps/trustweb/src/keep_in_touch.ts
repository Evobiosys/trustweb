// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 keep-in-touch: who is overdue by their cadence, who has gone quiet, and the once-a-day notice text. Owner-only, local. Pure, DOM-free. */
import { Ring } from './model'
import type { AppState, Person } from './model'
import { isOverdue, nextReminder } from './cadence'
import { isDeleted } from './deleted_people'
import { isArchived } from './trustzones'
import { soonNames, noticeDue } from './engagement'
import { lastContact } from './people_list'
import { webSlot } from './rings_layout'
import { S } from './strings'

const DAY_MS = 86_400_000
/** Without a cadence, this many days of silence count as gone quiet. */
export const QUIET_DAYS = 90
const QUIET_RINGS: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend]

type State = Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats' | 'keepNoticeDay'>>
const alive = (s: State): Person[] => s.people.filter((p) => !isDeleted(p) && !isArchived(p))

/** People past their cadence's reminder day, the longest overdue first. */
export function overduePeople(s: State, now: number): Person[] {
  const due = (p: Person): number => nextReminder(p, lastContact(s, p), now) ?? now
  return alive(s).filter((p) => isOverdue(p, lastContact(s, p), now)).sort((a, b) => due(a) - due(b))
}

/** Closest, Close and Friend people with no contact for more than twice their cadence (no cadence: 90 days). */
export function goneQuiet(s: State, now: number): Person[] {
  return alive(s).filter((p) => QUIET_RINGS.includes(webSlot(p)) && now - lastContact(s, p) > (p.cadenceDays ? 2 * p.cadenceDays : QUIET_DAYS) * DAY_MS)
}

/** "Time to get in touch: Anna, Ben, Cy and 2 more" (three names at most, then a count). */
export function noticeText(names: readonly string[]): string {
  const { names: shown, more } = soonNames(names.map((name) => ({ name })))
  return S.keepNoticeTitle(shown, more)
}

/** The notice goes out once a day, at the first check from 12:00 local. */
export const keepNoticeDue = (s: Pick<AppState, 'keepNoticeDay'>, now: Date): boolean => noticeDue({ engagementNoticeDay: s.keepNoticeDay }, now)
