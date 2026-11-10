// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the module's slice of the record (`AppState.extData['community-mighty']`), its check and its device-sync
 * merge. Pure and small on purpose: the always-loaded stub (index.ts) registers the merge, the rest of the module loads only when on.
 * The consent to load Google Docs or Telegram is NOT here: a consent belongs to the device it was given on (community_view.ts).
 */
export const MODULE_ID = 'community-mighty'
export const NAV = ['home', 'spaces', 'events', 'members', 'docs', 'chat'] as const
export type NavId = (typeof NAV)[number]

export interface Resource { id: string; title: string; url: string; by: string; at: number }
/** One member's own ordering and visibility of the shared resource list. `from` = whose view it was forked from. */
export interface ResourceView { owner: string; order: string[]; hidden: string[]; from?: string }

export interface CommunityData {
  tag?: string
  navOff?: NavId[]
  resources?: Resource[]
  /** My view of the resource list. */
  mine?: ResourceView
  /** Other members' views that reached this device (none travel yet). */
  views?: ResourceView[]
  docsUrl?: string
  telegramUrl?: string
  /** Wave 40 review: docsUrl / telegramUrl were moved into the embeds record once; they are kept, never adopted again. */
  linksMoved?: true
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : [])

/** http(s) only; the normalised link or null. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

function parseView(v: unknown): ResourceView | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!isStr(o.owner)) return undefined
  return { owner: o.owner, order: strs(o.order), hidden: strs(o.hidden), ...(isStr(o.from) ? { from: o.from } : {}) }
}

/** Every field checked (the slice rides the device sync like any setting); unknown fields dropped. */
export function parseCommunity(raw: unknown): CommunityData {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const d: CommunityData = {}
  if (isStr(o.tag)) d.tag = o.tag
  if (Array.isArray(o.navOff)) d.navOff = o.navOff.filter((n): n is NavId => (NAV as readonly unknown[]).includes(n))
  if (Array.isArray(o.resources)) {
    d.resources = o.resources.filter((r): r is Resource => !!r && typeof r === 'object' && isStr(r.id) && isStr(r.title) && isStr(r.url) && isStr(r.by) && typeof r.at === 'number' && safeUrl(r.url) !== null)
  }
  const mine = parseView(o.mine)
  if (mine) d.mine = mine
  if (Array.isArray(o.views)) d.views = o.views.map(parseView).filter((v): v is ResourceView => v !== undefined)
  if (isStr(o.docsUrl)) d.docsUrl = o.docsUrl
  if (isStr(o.telegramUrl)) d.telegramUrl = o.telegramUrl
  if (o.linksMoved === true) d.linksMoved = true
  return d
}

/**
 * Wave 40 review: the wave 39 Docs / Telegram links of this slice move into the embeds record ONCE (only the ones it lacks), and the slice is
 * marked, so a link later cleared in embeds is not brought back by the next mount. The old fields stay (nothing deleted). Null: nothing to do.
 */
export function legacyLinksPatch(d: CommunityData, have: { docsUrl?: string; telegramUrl?: string }): { patch: { docsUrl?: string; telegramUrl?: string } | null; next: CommunityData | null } {
  if (d.linksMoved || (!d.docsUrl && !d.telegramUrl)) return { patch: null, next: null }
  const patch = { ...(d.docsUrl && !have.docsUrl ? { docsUrl: d.docsUrl } : {}), ...(d.telegramUrl && !have.telegramUrl ? { telegramUrl: d.telegramUrl } : {}) }
  return { patch: Object.keys(patch).length ? patch : null, next: { ...d, linksMoved: true } }
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

/**
 * Two of my devices: resources join by id; my order keeps this device's first, then the other's additions; what either hid stays
 * hidden; other members' views by owner (the incoming one wins). Plain fields carry no stamp: the incoming value wins where it has one.
 */
export function mergeCommunity(mineRaw: unknown, theirsRaw: unknown): CommunityData {
  const a = parseCommunity(mineRaw)
  const b = parseCommunity(theirsRaw)
  const out: CommunityData = { ...a, ...b }
  const res = new Map([...(a.resources ?? []), ...(b.resources ?? [])].map((r) => [r.id, r]))
  if (res.size) out.resources = [...res.values()]
  if (a.mine || b.mine) {
    const hidden = union(a.mine?.hidden ?? [], b.mine?.hidden ?? [])
    const from = b.mine?.from ?? a.mine?.from
    out.mine = { owner: (b.mine ?? a.mine)!.owner, order: union(a.mine?.order ?? [], b.mine?.order ?? []).filter((id) => !hidden.includes(id)), hidden, ...(from ? { from } : {}) }
  }
  if (a.views || b.views) out.views = [...new Map([...(a.views ?? []), ...(b.views ?? [])].map((v) => [v.owner, v])).values()]
  return out
}
