// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard: the Home screen is a board of tiles in three columns. Default: the Web big in the centre, the requests of others on the
 * left (altruistic first), my own requests on the right. The person drags tiles between columns; the layout is stored in the record as
 * `homeLayout` (only when it differs from the default). Pure, no DOM, no imports: apps/mcp loads this file under plain node.
 */
export const HOME_COLS = ['left', 'center', 'right'] as const
export type HomeCol = (typeof HOME_COLS)[number]
/** asksToMe + connects = what others want of me; asksSent + invites = what I asked or offered. */
export const HOME_TILES = ['asksToMe', 'connects', 'web', 'asksSent', 'invites'] as const
export type HomeTile = (typeof HOME_TILES)[number]
export type HomeLayout = Record<HomeCol, HomeTile[]>

export const defaultLayout = (): HomeLayout => ({ left: ['asksToMe', 'connects'], center: ['web'], right: ['asksSent', 'invites'] })

const isTile = (v: unknown): v is HomeTile => (HOME_TILES as readonly unknown[]).includes(v)
const isCol = (v: unknown): v is HomeCol => (HOME_COLS as readonly unknown[]).includes(v)

/** A stored value made whole: unknown tiles and repeats dropped, a missing tile back in its default column. Anything that is not an object = the default. */
export function parseLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultLayout()
  const o = raw as Record<string, unknown>
  const seen = new Set<HomeTile>()
  const out: HomeLayout = { left: [], center: [], right: [] }
  for (const col of HOME_COLS) {
    for (const t of Array.isArray(o[col]) ? (o[col] as unknown[]) : []) if (isTile(t) && !seen.has(t)) { seen.add(t); out[col].push(t) }
  }
  const dflt = defaultLayout()
  for (const col of HOME_COLS) for (const t of dflt[col]) if (!seen.has(t)) out[col].push(t)
  return out
}

export const layoutOf = (s: { homeLayout?: unknown }): HomeLayout => parseLayout(s.homeLayout)

export const isDefaultLayout = (l: HomeLayout): boolean => JSON.stringify(l) === JSON.stringify(defaultLayout())

/** The layout with `id` taken out of its column and put into `col` at `index` (clamped). An unknown tile or column changes nothing. */
export function moveTile(l: HomeLayout, id: string, col: string, index: number): HomeLayout {
  if (!isTile(id) || !isCol(col)) return l
  const out: HomeLayout = { left: l.left.filter((t) => t !== id), center: l.center.filter((t) => t !== id), right: l.right.filter((t) => t !== id) }
  out[col].splice(Math.max(0, Math.min(out[col].length, Math.trunc(index))), 0, id)
  return out
}

/** Stores the layout in the record, or removes the key when it is the default. */
export function setHomeLayout(s: { homeLayout?: HomeLayout }, l: HomeLayout): void {
  if (isDefaultLayout(l)) delete s.homeLayout; else s.homeLayout = l
}

/** Settings > Home "Reset layout". */
export function resetLayout(s: { homeLayout?: HomeLayout }): void { delete s.homeLayout }

/** schema_version.ts step: a stored layout that is broken is repaired, one equal to the default is dropped. True when the record changed. */
export function repairHomeLayout(s: { homeLayout?: unknown }): boolean {
  if (s.homeLayout === undefined) return false
  const fixed = parseLayout(s.homeLayout)
  if (isDefaultLayout(fixed)) { delete s.homeLayout; return true }
  const changed = JSON.stringify(fixed) !== JSON.stringify(s.homeLayout)
  if (changed) s.homeLayout = fixed
  return changed
}
