// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter: the audience filter's plain data and its strict reading. No imports, so the MCP server (node, no bundler) can load it too. */

/** Posting publicly (the questhub server, Mastodon) is not built: the option shows, disabled. Flip after the Mastodon decision. */
export const PUBLIC_ASK_ENABLED = false

export type Zone = 'closest' | 'close' | 'friend'
/** Narrowest first: a zone always means itself and every narrower one. */
export const ZONES: readonly Zone[] = ['closest', 'close', 'friend']

export type Degree = 1 | 2 | 3

/** Chips are `person:<id>`, `tag:<id>` or `event:<id>` (the people who attended that event). `zone` absent = every connected person (hints and intros ask everybody by default). */
export interface AudienceFilter { zone?: Zone; add: string[]; exclude: string[]; degree: Degree }

export const DEFAULT_FILTER: AudienceFilter = { zone: undefined, add: [], exclude: [], degree: 1 }

const chipOk = (c: unknown): c is string => typeof c === 'string' && /^(person|tag|event):.+/.test(c)

function chipList(v: unknown): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new Error('add and exclude are a list')
  for (const c of v) if (!chipOk(c)) throw new Error('chips are person:<id>, tag:<id> or event:<id>')
  return [...new Set(v as string[])]
}

/** Strict reading of a stored or MCP filter; throws a plain message on anything unknown. */
export function parseFilter(raw: unknown): AudienceFilter {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.zone !== undefined && !ZONES.includes(r.zone as Zone)) throw new Error(`zone is one of ${ZONES.join(', ')}`)
  if (r.degree === 'public') {
    if (!PUBLIC_ASK_ENABLED) throw new Error('public asks are not available yet (coming after the Mastodon decision)')
  } else if (r.degree !== undefined && ![1, 2, 3].includes(r.degree as number)) throw new Error('degree is 1, 2 or 3')
  return { zone: r.zone as Zone | undefined, add: chipList(r.add), exclude: chipList(r.exclude), degree: (r.degree as Degree | undefined) ?? 1 }
}

