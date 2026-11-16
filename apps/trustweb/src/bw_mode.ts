// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Pure, no imports (safe for plain node). Wave 44 steer-strike-mode: Settings > Variations "Black and white mode". OFF toggles are dimmed; the line through them (P2) shows only when this is on.

/** True when OFF options get a line through them: only in Black and white mode. */
export const strikeOff = (s: { bwMode?: boolean } | undefined): boolean => s?.bwMode === true

/** Only the on state is stored. */
export function setBwMode(s: { bwMode?: boolean }, on: boolean): void {
  if (on) s.bwMode = true; else delete s.bwMode
}

/** wave44 steer-event-visibility stored this as strikeSwitchedOff; one switch remains. Idempotent; true when the record changed. */
export function migrateBwMode(s: { bwMode?: boolean; strikeSwitchedOff?: boolean }): boolean {
  if (!('strikeSwitchedOff' in s)) return false
  if (s.strikeSwitchedOff === true) s.bwMode = true
  delete s.strikeSwitchedOff
  return true
}
