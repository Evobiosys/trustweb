/**
 * Dismissible notices (wave 15): a small one-line note the app shows once in a while ("This username belonged to someone else before.")
 * can be dismissed with its x; AppState.dismissed holds the ids. The id "all-notices" (Settings > Advanced, "Don't show such notices")
 * silences every note. Pure: the caller saves.
 */
import type { AppState } from './model'

export const ALL_NOTICES = 'all-notices'
/** At most this many ids are kept (the oldest drop first): a note that comes back after that is only shown once more. */
export const DISMISSED_MAX = 200

/** The id of the "this username had a previous owner" note for a typed code or name. */
export const namePreviousId = (key: string): string => `name-previous:${key}`

/** Should the note `id` be shown? */
export function noticeShown(s: Pick<AppState, 'dismissed'>, id: string): boolean {
  const d = s.dismissed ?? []
  return !d.includes(ALL_NOTICES) && !d.includes(id)
}

/** Dismisses the note `id` (idempotent). */
export function dismissNotice(s: AppState, id: string): void {
  const d = s.dismissed ?? []
  if (!d.includes(id)) s.dismissed = [...d, id].slice(-DISMISSED_MAX)
}

/** The general switch: on keeps "all-notices" in the list, off removes it (and an emptied list is dropped, so the record keeps only what differs). */
export function setNoticesOff(s: AppState, off: boolean): void {
  const rest = (s.dismissed ?? []).filter((x) => x !== ALL_NOTICES)
  const next = off ? [...rest.slice(-(DISMISSED_MAX - 1)), ALL_NOTICES] : rest
  if (next.length) s.dismissed = next
  else delete s.dismissed
}

export const noticesOff = (s: Pick<AppState, 'dismissed'>): boolean => (s.dismissed ?? []).includes(ALL_NOTICES)
