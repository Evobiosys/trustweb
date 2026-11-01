// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 (share wording): share profiles = named groups of people and tags for the "in addition" list, saved once and picked per share.
 * By default a profile leaves out whoever sits on the "don't share with" list; Settings > Sharing can let profiles win (AppState.shareProfilesWin).
 * Pure, no DOM.
 */
import { withChip, type PageState } from './share_page'

export interface ShareProfile { id: string; name: string; members: string[] }

/** Saves `members` (chip ids) under `name`; a known name (any case) is replaced, which is how a profile is curated. */
export function saveProfile(list: readonly ShareProfile[], name: string, members: readonly string[]): ShareProfile[] {
  const n = name.trim()
  const known = list.find((p) => p.name.toLowerCase() === n.toLowerCase())
  const next: ShareProfile = { id: known?.id ?? `${Date.now().toString(36)}${list.length}`, name: known?.name ?? n, members: [...new Set(members)] }
  return known ? list.map((p) => (p === known ? next : p)) : [...list, next]
}

export const removeProfile = (list: readonly ShareProfile[], id: string): ShareProfile[] => list.filter((p) => p.id !== id)

/** The profile's members join the "in addition" list; the ones on the "don't share with" list stay out unless `wins`. */
export function applyProfile(page: PageState, profile: ShareProfile, wins: boolean): PageState {
  return profile.members.filter((m) => wins || !page.exclude.includes(m)).reduce((s, m) => withChip(s, 'include', m), page)
}
