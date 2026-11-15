// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 P4: the event tag helpers. A leaf with no imports so apps/mcp loads it under plain node; events.ts re-exports it (one definition). */

/** P4 (wave 43): every event is a tag. In code, URLs, QR payloads and ids: `event_<slug>` (lowercase, spaces to underscore, other punctuation stripped). */
export function eventTagSlug(name: string): string {
  return `event_${name.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_]+/gu, '').replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '')}`
}

/** P4: how the tag shows in the app: `#event:<name>`. */
export const eventTagLabel = (name: string): string => `#event:${name.trim()}`
