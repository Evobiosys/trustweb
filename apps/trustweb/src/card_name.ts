// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { cleanHelloName } from './hello'

/**
 * The name a card edit saves, or null when nothing should be saved (empty or unchanged: the old name stays).
 * person.name is the owner's own name for the person; a peer's hello only fills a placeholder (wantsHelloName), so an edit is never overwritten.
 */
export function renamedTo(current: string, typed: string): string | null {
  const next = cleanHelloName(typed)
  return next && next !== current ? next : null
}
