// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 P4: the event tag helpers. A leaf with no imports so apps/mcp loads it under plain node; events.ts re-exports it (one definition). feed_social.ts repeats eventTagSlug (plain-node leaf too); review_fixes_43.test.mjs keeps the two equal. */

/** Jakob's answer (2026-11-15, eta): the slug keeps the letter case ('keep' = event_Winter_IYG; 'lower' = event_winter_iyg). One-line switch; feed_social.ts carries the same constant. Every comparison of two event tags goes through sameEventTag. */
export const EVENT_SLUG_CASE: 'lower' | 'keep' = 'keep'

/** P4 (wave 43): every event is a tag. In code, URLs, QR payloads and ids: `event_<slug>` (case per EVENT_SLUG_CASE, spaces to underscore, other punctuation stripped). */
export function eventTagSlug(name: string): string {
  const cased = EVENT_SLUG_CASE === 'lower' ? name.trim().toLowerCase() : name.trim()
  return `event_${cased.replace(/[^\p{L}\p{N}\s_]+/gu, '').replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '')}`
}

/** P4: how the tag shows in the app: `#event:<name>`. */
export const eventTagLabel = (name: string): string => `#event:${name.trim()}`

/** Two event tags (`event_<slug>`) are the same event tag whatever their letter case; the one comparison every search, match and filter uses. feed_social.ts repeats it (plain-node leaf). */
export const sameEventTag = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()
