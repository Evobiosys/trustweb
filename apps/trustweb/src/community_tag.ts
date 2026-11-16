// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities (item 8): the community meta tag. A community `IYG` is `#community:IYG` in the app, `community_IYG` in code,
 * and still findable by typing `#IYG`; the bare `community` chip means everyone who shares any community with me. Pure, no imports
 * (apps/mcp loads it under plain node).
 */
/** The bare filter chip (uiRings.show / hide): any community tag. */
export const COMMUNITY_CHIP = 'community'

const slug = (name: string): string => name.trim().replace(/[^\p{L}\p{N}\s_]+/gu, '').replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '')

/** Code form, like eventTagSlug: `community_<name>`. */
export const communityTag = (name: string): string => `community_${slug(name)}`
/** App form: `#community:<name>`. */
export const communityLabel = (name: string): string => `#community:${name.trim()}`

/** The rows the tag picker offers for a query that names the meta tag (`#community…`): the bare tag, then every community tag. */
export function communityPickerRows(query: string, tags: readonly { id: string; label?: string; community?: boolean }[]): { id: string; label: string }[] {
  const q = query.trim().replace(/^#/, '').toLowerCase()
  if (!q || !'community'.startsWith(q.split(':')[0])) return []
  const all = tags.filter((t) => t.community === true)
  if (!all.length) return []
  return [{ id: COMMUNITY_CHIP, label: '#community' }, ...all.map((t) => ({ id: `tag:${t.id}`, label: communityLabel(t.label ?? t.id) }))]
}
