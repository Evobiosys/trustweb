// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Community dashboard aggregate (wave 43c connect-extras, theta). The opt-in "Share my tile layout anonymously" of a community's Home.
//
//   POST /community/agg           {communityId, slot, tiles:[tileId...]}   204: keeps the tile set under (communityId, slot); a new post of the same slot replaces it
//   GET  /community/agg/<id>      200 {n, tiles:{tileId: count}} from AGG_MIN_MEMBERS members on, else 404 not_found (also for an unknown or malformed id)
//
// PRIVACY: a slot is random hex the member's phone made for that community; it is not a name, key, device or account, and the answer never lists slots.
// Nothing is logged (no logger is passed in) and the store sits in memory: after a restart members' phones post again on their next open. Slots older than
// AGG_TTL_DAYS leave the count; a community keeps at most cfg.aggMaxSlots slots (the oldest go first) and the server at most AGG_MAX_COMMUNITIES.
// NOT MOUNTED YET: server.mjs is a shared file. To mount: `const dashAgg = createDashboardAgg({ cfg, clientOf, now: cfg.now })` and
// `if (isAggPath(pathname)) return dashAgg.handle(req, res)` beside the /org routes; config: aggPerMinute (default 60), aggMaxSlots (default 2000).
// ABUSE: per network address in memory; bodies capped at 2 KB, JSON only, own-host Origin only.

import { jsonError, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { originAllowed, readJsonObject } from './links.mjs'

export const AGG_MIN_MEMBERS = 3
export const AGG_TTL_DAYS = 90
const AGG_MAX_COMMUNITIES = 10_000
const MAX_BYTES = 2048
/** The tiles of the community Home (apps/trustweb/src/ext/community-mighty/community_data.ts TILES). */
const TILES = ['events', 'spaces', 'docs', 'members', 'resources', 'timeline']
const COMMUNITY_RE = /^[A-Za-z0-9_-]{1,64}$/
const SLOT_RE = /^[0-9a-f]{16,64}$/
const PATH_RE = /^\/community\/agg(?:\/([^/]+))?$/

export const isAggPath = (pathname) => PATH_RE.test(pathname)

export function createDashboardAgg({ cfg, clientOf, now = Date.now }) {
  const limiter = createWindowLimiter({ limit: cfg.aggPerMinute ?? 60, windowMs: 60_000, now })
  const maxSlots = cfg.aggMaxSlots ?? 2000
  /** communityId -> Map(slot -> {tiles, at}) */
  const store = new Map()

  function guard(req, res) {
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return jsonError(res, 403, 'forbidden_origin')
    const origin = req.headers.origin
    if (origin !== undefined && !originAllowed(origin, cfg.linkHosts)) return jsonError(res, 403, 'forbidden_origin')
    const hit = limiter.hit(ipKey(clientOf(req)))
    if (hit.limited) return tooManyRequests(res, 'rate_limited', hit.retryAfter)
    return null
  }

  function live(id) {
    const slots = store.get(id)
    if (!slots) return null
    const cutoff = now() - AGG_TTL_DAYS * 86_400_000
    for (const [k, v] of slots) if (v.at < cutoff) slots.delete(k)
    if (!slots.size) { store.delete(id); return null }
    return slots
  }

  async function post(req, res) {
    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return refuse(req, res, 415, 'unsupported_media')
    const read = await readJsonObject(req, MAX_BYTES)
    if (read.error === 'too_large') return refuse(req, res, 413, 'too_large')
    if (read.error !== undefined) return jsonError(res, read.status, read.error)
    const { communityId, slot, tiles } = read.body
    if (typeof communityId !== 'string' || !COMMUNITY_RE.test(communityId)) return jsonError(res, 400, 'bad_request', { field: 'communityId' })
    if (typeof slot !== 'string' || !SLOT_RE.test(slot)) return jsonError(res, 400, 'bad_request', { field: 'slot' })
    if (!Array.isArray(tiles) || tiles.length > TILES.length * 2 || !tiles.every((t) => TILES.includes(t))) return jsonError(res, 400, 'bad_request', { field: 'tiles' })
    if (!store.has(communityId) && store.size >= AGG_MAX_COMMUNITIES) return jsonError(res, 503, 'full')
    const slots = live(communityId) ?? new Map()
    slots.delete(slot)
    slots.set(slot, { tiles: [...new Set(tiles)], at: now() })
    while (slots.size > maxSlots) slots.delete(slots.keys().next().value)
    store.set(communityId, slots)
    sendJson(res, 204)
    return 204
  }

  function get(res, id) {
    const slots = COMMUNITY_RE.test(id) ? live(id) : null
    if (!slots || slots.size < AGG_MIN_MEMBERS) return jsonError(res, 404, 'not_found')
    const tiles = {}
    for (const v of slots.values()) for (const t of v.tiles) tiles[t] = (tiles[t] ?? 0) + 1
    sendJson(res, 200, { n: slots.size, tiles })
    return 200
  }

  /** Answers the request and returns the status. */
  async function handle(req, res) {
    const m = PATH_RE.exec(new URL(req.url ?? '/', 'http://x').pathname)
    if (!m) return jsonError(res, 404, 'not_found')
    const method = m[1] === undefined ? 'POST' : 'GET'
    if (req.method !== method) return jsonError(res, 405, 'method_not_allowed', {}, { Allow: method })
    const refused = guard(req, res)
    if (refused !== null) return refused
    if (m[1] === undefined) return post(req, res)
    let id = ''
    try { id = decodeURIComponent(m[1]) } catch { return jsonError(res, 404, 'not_found') }
    return get(res, id)
  }

  return { handle }
}
