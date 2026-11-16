// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (theta): the client of the community's server for the opt-in dashboard aggregate. The server abstraction of social-hosting
 * is not merged yet, so this is the small client it will sit behind; tests mock it. Endpoints (same origin, services/trustweb-backup/dashboard_agg.mjs):
 *   POST /community/agg           {communityId, slot, tiles:[tileId...]}  ->  204   (the slot is random, not linked to a name, key or device; a new post replaces the old)
 *   GET  /community/agg/<id>      ->  200 {n, tiles:{tileId: count}}  (404 or n < AGG_MIN_MEMBERS: nothing is shown)
 * Nothing is sent unless the member switched "Share my tile layout anonymously" on for that community (community_data.ts shareLayoutOn).
 */
import { TILES, type TileAggregate } from './community_data'
import { serversAllowed } from '../../trust_mode'

export const COMMUNITY_AGG_PATH = '/community/agg'
/** The server answers a summary only from this many members on, and the app shows nothing below it: a layout of one or two people is identifiable. */
export const AGG_MIN_MEMBERS = 3

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: 'no-store' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** The server's answer checked: n a whole number from AGG_MIN_MEMBERS, counts of known tiles only and never more than n; else null. */
export function parseAggregate(v: unknown): TileAggregate | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { n?: unknown; tiles?: unknown }
  if (typeof o.n !== 'number' || !Number.isInteger(o.n) || o.n < 0 || !o.tiles || typeof o.tiles !== 'object' || Array.isArray(o.tiles)) return null
  const tiles: Record<string, number> = {}
  for (const [k, c] of Object.entries(o.tiles)) {
    if (!(TILES as readonly string[]).includes(k)) continue
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > o.n) return null
    tiles[k] = c
  }
  return { n: o.n, tiles }
}

/** review-fixes-43c: the layout goes to the server only with the community's opt-in AND while "Only through people I trust (no servers)" is off. */
export const layoutShareAllowed = (s: { trustedOnly?: boolean }, optedIn: boolean): boolean => optedIn && serversAllowed(s)

/** Sends my tile set; true when the server took it. A failure is silent (nothing leaves the phone beyond this one message). */
export async function sendTileSet(f: FetchLike, communityId: string, slot: string, tiles: readonly string[]): Promise<boolean> {
  try {
    const r = await f(COMMUNITY_AGG_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ communityId, slot, tiles }) })
    return r.ok
  } catch { return false }
}

/** The community's aggregate, or null (no server answer, malformed, or fewer than AGG_MIN_MEMBERS members shared). */
export async function fetchAggregate(f: FetchLike, communityId: string): Promise<TileAggregate | null> {
  try {
    const r = await f(`${COMMUNITY_AGG_PATH}/${encodeURIComponent(communityId)}`, { cache: 'no-store' })
    if (!r.ok) return null
    const agg = parseAggregate(await r.json())
    return agg && agg.n >= AGG_MIN_MEMBERS ? agg : null
  } catch { return null }
}
